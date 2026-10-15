// Copies every `.env.example` in apps/* and packages/* to `.env` unless one already exists.
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const group of ['apps', 'packages']) {
  for (const name of readdirSync(join(root, group))) {
    const example = join(root, group, name, '.env.example');
    const target = join(root, group, name, '.env');
    if (!existsSync(example)) continue;
    if (existsSync(target)) {
      console.log(`skip   ${group}/${name}/.env (exists)`);
      continue;
    }
    copyFileSync(example, target);
    console.log(`create ${group}/${name}/.env`);
  }
}
