// Writes docs/samples/invoice-sample.pdf from synthetic data (no database), so the layout and
// the embedded Georgian font can be checked without running the stack:
//   pnpm --filter @geo-ie-accounting/api invoice:sample
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InvoiceView } from '@geo-ie-accounting/contracts';
import { computeInvoiceTotals } from '@geo-ie-accounting/domain';
import { renderInvoicePdf } from '../src/routes/invoices/pdf/render';

const ORG = '00000000-0000-7000-8000-000000000001';
const CLIENT = '00000000-0000-7000-8000-000000000002';
const INVOICE = '00000000-0000-7000-8000-000000000003';

const lines = [
  { description: 'Backend development, September 2026', quantity: '62.5', unitPriceMinor: 4500n },
  { description: 'Code review and architecture workshop', quantity: '1', unitPriceMinor: 60000n },
  {
    description: 'ვებ-აპლიკაციის მხარდაჭერა (Georgian line)',
    quantity: '3',
    unitPriceMinor: 12550n,
  },
];
const totals = computeInvoiceTotals('USD', lines);
const at = '2026-10-01T09:00:00.000Z';

const invoice: InvoiceView = {
  id: INVOICE,
  orgId: ORG,
  clientId: CLIENT,
  number: 'INV-2026-007',
  numberYear: 2026,
  numberSeq: 7,
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  currency: 'USD',
  status: 'issued',
  bankAccountId: null,
  notes: 'Thank you for your business.\nHours are from the shared time sheet.',
  totalMinor: totals.totalMinor,
  issuedAt: at,
  voidedAt: null,
  createdAt: at,
  updatedAt: at,
  clientName: 'Northwind Analytics GmbH',
  paidMinor: 0n,
  outstandingMinor: totals.totalMinor,
  overdue: false,
  client: {
    id: CLIENT,
    orgId: ORG,
    name: 'Northwind Analytics GmbH',
    taxId: 'DE123456789',
    address: 'Friedrichstraße 100\n10117 Berlin',
    email: 'accounts@northwind.example',
    country: 'DE',
    defaultCurrency: 'USD',
    notes: null,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
  },
  lines: lines.map((l, i) => ({
    id: `00000000-0000-7000-8000-00000000010${i}`,
    invoiceId: INVOICE,
    orgId: ORG,
    position: i,
    ...l,
    lineTotalMinor: totals.lineTotalsMinor[i] ?? 0n,
  })),
  payments: [],
  parties: {
    seller: {
      name: 'ი/მ გიორგი ბერიძე (Giorgi Beridze IE)',
      taxId: '01001012345',
      address: 'რუსთაველის გამზირი 12\nთბილისი 0108, საქართველო',
      email: 'giorgi@beridze.example',
      phone: '+995 555 12 34 56',
      country: 'GE',
    },
    client: {
      name: 'Northwind Analytics GmbH',
      taxId: 'DE123456789',
      address: 'Friedrichstraße 100\n10117 Berlin',
      email: 'accounts@northwind.example',
      phone: null,
      country: 'DE',
    },
    bank: {
      accountName: 'Bank of Georgia USD',
      bank: 'Bank of Georgia',
      iban: 'GE00BG0000000000000001',
      currency: 'USD',
    },
    note: 'Not registered for VAT in Georgia. გმადლობთ!',
  },
};

const target = fileURLToPath(new URL('../../../docs/samples/invoice-sample.pdf', import.meta.url));
await mkdir(dirname(target), { recursive: true });
await writeFile(target, await renderInvoicePdf(invoice));
process.stdout.write(`Wrote ${target}\n`);
