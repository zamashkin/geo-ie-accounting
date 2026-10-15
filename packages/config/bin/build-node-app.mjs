#!/usr/bin/env node
// Bundles a Node app (apps/api, apps/worker) into dist/ with esbuild.
//
// Workspace packages (@ie-ledger/*) are TypeScript sources, so they are bundled in. npm packages
// the app lists in its own package.json stay external and are installed next to it in production
// (`pnpm deploy`). Other npm packages reached only through workspace packages are bundled.
//
// Usage (from the app directory): ie-build-node-app src/main.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: build-node-app.mjs <entry>');
  process.exit(1);
}

const cwd = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
const ownDeps = new Set(Object.keys(manifest.dependencies ?? {}));
// Optional native add-ons that are required inside try/catch by their parents.
const alwaysExternal = new Set(['pg-native']);

/**
 * @param {string} spec
 * @returns {string}
 */
const packageName = (spec) =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/');

/** @type {import('esbuild').Plugin} */
const externals = {
  name: 'ie-ledger-externals',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('node:')) return { external: true };
      const name = packageName(args.path);
      if (name.startsWith('@ie-ledger/')) return undefined;
      if (ownDeps.has(name) || alwaysExternal.has(name)) return { external: true };
      return undefined;
    });
  },
};

await build({
  entryPoints: [entry],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externals],
  // CommonJS dependencies bundled into ESM may call require().
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
