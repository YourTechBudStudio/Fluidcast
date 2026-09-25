/**
 * Bundles the CLI with every dependency into `dist/fluidcast.mjs` and copies the built web app to
 * `dist/web/`, producing a package that runs with only Node. Run through `pnpm bundle`, which
 * builds the workspace dependencies and the web app first.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { build } from 'rolldown';

const cli = fileURLToPath(new URL('../', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const web = fileURLToPath(new URL('../../web/dist/', import.meta.url));

if (!existsSync(web)) throw new Error(`The web app is not built: ${web} does not exist.`);
rmSync(dist, { recursive: true, force: true });

await build({
  cwd: cli,
  input: 'src/main.ts',
  platform: 'node',
  transform: { target: 'node26' },
  output: {
    file: 'dist/fluidcast.mjs',
    format: 'esm',
    banner: '#!/usr/bin/env node',
    codeSplitting: false,
  },
});

cpSync(web, `${dist}web`, { recursive: true });
console.log(`Bundled ${dist}fluidcast.mjs and ${dist}web/`);
