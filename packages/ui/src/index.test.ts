import { describe, expect, it } from 'vitest';
import { isNavItemActive } from './components/app-shell/SidebarNav';
import { orgInitials } from './components/app-shell/OrgSwitcher';
import { fileMatches, formatBytes } from './components/file-dropzone/FileDropzone';
import { cx } from './lib/cx';

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('isNavItemActive', () => {
  it('matches the path and its children by default', () => {
    expect(isNavItemActive({ href: '/o/1/imports' }, '/o/1/imports')).toBe(true);
    expect(isNavItemActive({ href: '/o/1/imports' }, '/o/1/imports/new')).toBe(true);
    expect(isNavItemActive({ href: '/o/1/imports' }, '/o/1/imports-old')).toBe(false);
  });

  it('matches exactly when asked (the dashboard)', () => {
    expect(isNavItemActive({ href: '/o/1', match: 'exact' }, '/o/1/')).toBe(true);
    expect(isNavItemActive({ href: '/o/1', match: 'exact' }, '/o/1/transactions')).toBe(false);
  });
});

describe('orgInitials', () => {
  it.each([
    ['Nino Beridze IE', 'NB'],
    ['acme', 'AC'],
    ['  ', '?'],
  ])('%j -> %s', (name, expected) => {
    expect(orgInitials(name)).toBe(expected);
  });
});

describe('fileMatches', () => {
  const csv = { name: 'Statement.CSV', type: 'text/csv' };
  it('matches by extension, case-insensitively', () => {
    expect(fileMatches(csv, ['.csv'])).toBe(true);
    expect(fileMatches(csv, ['.xlsx'])).toBe(false);
  });

  it('matches by MIME type and wildcard', () => {
    expect(fileMatches(csv, ['text/csv'])).toBe(true);
    expect(fileMatches(csv, ['text/*'])).toBe(true);
  });

  it('accepts anything when no rule is given', () => {
    expect(fileMatches(csv, [])).toBe(true);
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [15 * 1024 * 1024, '15 MB'],
  ])('%d -> %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
