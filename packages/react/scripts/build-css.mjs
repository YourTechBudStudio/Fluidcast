// Builds `dist/styles.css`, the player's one stylesheet: Tailwind compiles `src/styles/player.css`, `scopePlayer`
// confines every rule to the player root, and the font imports go first, unbundled, so each host's bundler resolves
// them through this package's dependencies.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';

import { scopePlayer } from './scope-css.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'src/styles/player.css');
const to = resolve(root, 'dist/styles.css');

/** The player root's class (`ui/instance.tsx`'s `ROOT_CLASS`). */
const ROOT = '.fluidcast-player';

const FONTS = [
  '@fontsource-variable/sora',
  '@fontsource-variable/source-sans-3',
  '@fontsource-variable/fira-code',
];

const result = await postcss([tailwindcss(), scopePlayer(ROOT)]).process(
  await readFile(from, 'utf8'),
  { from, to },
);
const fonts = FONTS.map((name) => `@import '${name}';`).join('\n');
await mkdir(dirname(to), { recursive: true });
await writeFile(to, `${fonts}\n\n${result.css}`);
