import { geoIeAccounting } from '@geo-ie-accounting/config/eslint';

export default geoIeAccounting({
  pkg: 'db',
  root: import.meta.dirname,
  extra: [{ files: ['src/scripts/**'], rules: { 'no-console': 'off' } }],
});
