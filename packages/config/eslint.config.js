import { ieLedger } from './eslint/index.js';

export default ieLedger({
  pkg: 'config',
  root: import.meta.dirname,
  extra: [{ files: ['bin/**'], rules: { 'no-console': 'off' } }],
});
