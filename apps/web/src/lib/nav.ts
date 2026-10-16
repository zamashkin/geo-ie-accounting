/** Org-scoped routes from ARCHITECTURE §9, in sidebar order. Icons are chosen by the shell. */
export const ORG_NAV = [
  { key: 'dashboard', label: 'Dashboard', path: '', match: 'exact' },
  { key: 'transactions', label: 'Transactions', path: '/transactions', match: 'prefix' },
  { key: 'imports', label: 'Imports', path: '/imports', match: 'prefix' },
  { key: 'declarations', label: 'Declarations', path: '/declarations', match: 'prefix' },
  { key: 'invoices', label: 'Invoices', path: '/invoices', match: 'prefix' },
  { key: 'clients', label: 'Clients', path: '/clients', match: 'prefix' },
] as const;

export const ORG_SETTINGS_NAV = [
  { key: 'workspace', label: 'Workspace', path: '/settings', match: 'exact' },
  { key: 'accounts', label: 'Accounts', path: '/settings/accounts', match: 'prefix' },
  { key: 'rules', label: 'Rules', path: '/settings/rules', match: 'prefix' },
  { key: 'members', label: 'Members', path: '/settings/members', match: 'prefix' },
  { key: 'audit', label: 'Audit log', path: '/settings/audit', match: 'prefix' },
] as const;

export type OrgNavKey = (typeof ORG_NAV)[number]['key'] | (typeof ORG_SETTINGS_NAV)[number]['key'];

/** Workspace creation (first run, and "New workspace" in the switcher). */
export const NEW_ORG_PATH = '/orgs/new';

export function orgHref(orgId: string, path = ''): string {
  return `/o/${orgId}${path}`;
}
