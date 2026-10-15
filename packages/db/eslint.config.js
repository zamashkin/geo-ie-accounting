import { ieLedger } from '@ie-ledger/config/eslint';

export default ieLedger({
  pkg: 'db',
  root: import.meta.dirname,
  extra: [{ files: ['src/scripts/**'], rules: { 'no-console': 'off' } }],
});
