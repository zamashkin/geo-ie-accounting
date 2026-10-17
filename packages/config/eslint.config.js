import { geoIeAccounting } from './eslint/index.js';

export default geoIeAccounting({
  pkg: 'config',
  root: import.meta.dirname,
  extra: [{ files: ['bin/**'], rules: { 'no-console': 'off' } }],
});
