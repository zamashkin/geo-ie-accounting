// Writes apps/api/openapi.json from the Zod route schemas. CI regenerates it and fails on a diff.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app';

const app = await buildApp(
  { version: 'openapi', webOrigin: 'http://localhost:3000', logger: false },
  { checkDatabase: () => Promise.resolve(true) },
);
await app.ready();
const spec = app.swagger();
const target = fileURLToPath(new URL('../openapi.json', import.meta.url));
await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`);
await app.close();
process.stdout.write(`Wrote ${target}\n`);
