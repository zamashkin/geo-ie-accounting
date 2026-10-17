// Accounts (WS-06): the chart of accounts and bank accounts, their balances, create, rename,
// archive. IBANs are personal data: never logged.
import {
  AccountBalanceList,
  AccountList,
  AccountParams,
  Account,
  CreateAccountRequest,
  ListAccountsQuery,
  MutationHeaders,
  OrgParams,
  UpdateAccountRequest,
  type AccountBalance,
} from '@geo-ie-accounting/contracts';
import {
  accountBalances,
  createAccount,
  getRateFor,
  listAccounts,
  lockAccount,
  updateAccount,
  type AccountRow,
} from '@geo-ie-accounting/db';
import {
  BASE_CURRENCY,
  formatRate,
  isSupportedCurrency,
  money,
  parseRate,
  SUPPORTED_CURRENCIES,
  toGel,
} from '@geo-ie-accounting/domain';
import { tbilisiDate } from '@geo-ie-accounting/nbg';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../../plugins/authz';
import { HttpProblem, problemResponse } from '../../problem';
import { isBankAccount, toAccountDto } from '../dto';
import type { LedgerDeps } from '../ledger-deps';

/** Liability, equity and income accounts normally carry a credit (negative) balance. */
const CREDIT_NORMAL = new Set<AccountRow['kind']>(['liability', 'equity', 'income']);

export const accountRoutes: FastifyPluginAsyncZod<{ deps: LedgerDeps }> = async (app, opts) => {
  app.get(
    '/v1/orgs/:orgId/accounts',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listAccounts',
        tags: ['accounts'],
        summary: 'Accounts of the organization (chart of accounts and bank accounts)',
        description: 'Active accounts, oldest first; `includeArchived=true` adds archived ones.',
        params: OrgParams,
        querystring: ListAccountsQuery,
        response: { 200: AccountList, default: problemResponse },
      },
    },
    async (req) => {
      const rows = await listAccounts(app.db, req.params.orgId, {
        includeArchived: req.query.includeArchived === 'true',
      });
      return { items: rows.map(toAccountDto) };
    },
  );

  app.get(
    '/v1/orgs/:orgId/accounts/balances',
    {
      onRequest: requireRole('viewer'),
      schema: {
        operationId: 'listAccountBalances',
        tags: ['accounts'],
        summary: 'Balance of every account per currency, and bank accounts in GEL',
        description:
          'Balances are on the normal side of the account (credit for liability, equity and ' +
          'income). Bank accounts are also valued in GEL at the latest stored NBG rate; no ' +
          'NBG request is made.',
        params: OrgParams,
        response: { 200: AccountBalanceList, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId } = req.params;
      const asOf = tbilisiDate(opts.deps.now());
      const [accounts, sums] = await Promise.all([
        listAccounts(app.db, orgId, { includeArchived: true }),
        accountBalances(app.db, orgId),
      ]);
      const byAccount = new Map<string, { currency: string; amountMinor: bigint }[]>();
      for (const s of sums) {
        const list = byAccount.get(s.accountId) ?? [];
        list.push({ currency: s.currency, amountMinor: s.amountMinor });
        byAccount.set(s.accountId, list);
      }

      let bankTotalGelMinor = 0n;
      const bankAccountsWithoutRate: string[] = [];
      const items: AccountBalance[] = [];
      for (const account of accounts) {
        const raw = byAccount.get(account.id) ?? [];
        const balances = raw.map((b) => ({
          currency: b.currency,
          amountMinor: CREDIT_NORMAL.has(account.kind) ? -b.amountMinor : b.amountMinor,
        }));
        let gelValue: AccountBalance['gelValue'] = null;
        if (isBankAccount(account) && account.currency) {
          const own = raw.find((b) => b.currency === account.currency)?.amountMinor ?? 0n;
          if (account.currency === BASE_CURRENCY || own === 0n) {
            gelValue = { amountMinor: account.currency === BASE_CURRENCY ? own : 0n, rate: null };
          } else {
            const rate = await getRateFor(app.db, account.currency, asOf);
            if (rate) {
              const gel = toGel(money(own, account.currency), {
                rateScaled: parseRate(rate.rate),
                quantity: rate.quantity,
              });
              gelValue = {
                amountMinor: gel.amountMinor,
                rate: {
                  rate: formatRate(parseRate(rate.rate)),
                  quantity: rate.quantity,
                  validFrom: rate.validFrom,
                },
              };
            } else {
              bankAccountsWithoutRate.push(account.id);
            }
          }
          if (gelValue) bankTotalGelMinor += gelValue.amountMinor;
        }
        items.push({ accountId: account.id, balances, gelValue });
      }
      return { items, asOf, bankTotalGelMinor, bankAccountsWithoutRate };
    },
  );

  app.post(
    '/v1/orgs/:orgId/accounts',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'createAccount',
        tags: ['accounts'],
        summary: 'Create an account (a bank account needs a currency; the IBAN is optional)',
        headers: MutationHeaders,
        params: OrgParams,
        body: CreateAccountRequest,
        response: { 201: Account, default: problemResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      const b = req.body;
      if (b.currency && !isSupportedCurrency(b.currency)) {
        throw new HttpProblem(422, 'validation_failed', 'This currency is not supported.', [
          {
            path: 'body/currency',
            message: `Use one of ${SUPPORTED_CURRENCIES.join(', ')}`,
          },
        ]);
      }
      const created = await createAccount(req.tx, orgId, {
        name: b.name,
        kind: b.kind,
        currency: b.currency ?? null,
        incomeClass: b.kind === 'income' ? (b.incomeClass ?? null) : null,
        bank: b.kind === 'asset' ? (b.bank ?? (b.iban ? 'other' : null)) : null,
        iban: b.kind === 'asset' ? (b.iban ?? null) : null,
      });
      await req.audit('account', created.id, null, created);
      reply.code(201);
      return toAccountDto(created);
    },
  );

  app.patch(
    '/v1/orgs/:orgId/accounts/:accountId',
    {
      onRequest: requireRole('accountant'),
      schema: {
        operationId: 'updateAccount',
        tags: ['accounts'],
        summary: 'Rename, archive or restore an account',
        description:
          'Archived accounts are hidden from pickers but keep their history. A bank account ' +
          'can only be archived at a zero balance; system accounts cannot be archived.',
        headers: MutationHeaders,
        params: AccountParams,
        body: UpdateAccountRequest,
        response: { 200: Account, default: problemResponse },
      },
    },
    async (req) => {
      const { orgId, accountId } = req.params;
      const account = await lockAccount(req.tx, orgId, accountId);
      if (!account) throw new HttpProblem(404, 'not_found', 'Account not found.');

      const patch: { name?: string; archivedAt?: Date | null } = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.archived === true && account.archivedAt === null) {
        if (account.systemKey) {
          throw new HttpProblem(409, 'conflict', 'System accounts cannot be archived.');
        }
        if (isBankAccount(account)) {
          const open = await accountBalances(req.tx, orgId, { accountId });
          if (open.length > 0) {
            throw new HttpProblem(
              409,
              'conflict',
              'This bank account still has a balance. Archive it once the balance is zero.',
            );
          }
        }
        patch.archivedAt = new Date();
      } else if (req.body.archived === false && account.archivedAt !== null) {
        patch.archivedAt = null;
      }

      const updated =
        Object.keys(patch).length === 0
          ? account
          : await updateAccount(req.tx, orgId, accountId, patch);
      const action =
        patch.archivedAt === undefined ? 'update' : patch.archivedAt ? 'archive' : 'restore';
      await req.audit(
        'account',
        accountId,
        { name: account.name, archivedAt: account.archivedAt },
        { name: updated.name, archivedAt: updated.archivedAt },
        { action },
      );
      return toAccountDto(updated);
    },
  );
};
