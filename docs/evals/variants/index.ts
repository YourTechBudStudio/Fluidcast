import { readdirSync } from 'node:fs';

/** The variant registry: built-in variants plus one file per generated variant in variants/gen. */
import type { Variant } from '../lib/drive.ts';
import { d1Ask, d1AskNoEx, d1AskNoRem, d1Nat, prodFlow } from './blocks.ts';

const builtIn = [prodFlow, d1Ask, d1Nat, d1AskNoEx, d1AskNoRem];

/** Generated variants: one file per variant in variants/gen, default-exporting a `Variant`. */
const genDir = new URL('./gen/', import.meta.url);
const generated: Array<Variant> = [];
for (const file of readdirSync(genDir)
  .filter((f) => f.endsWith('.ts'))
  .sort()) {
  const module = (await import(new URL(file, genDir).href)) as { default: Variant };
  if (module.default.id !== file.replace(/\.ts$/, '')) {
    throw new Error(`variants/gen/${file}: id must equal the file name`);
  }
  generated.push(module.default);
}

export const variants: Record<string, Variant> = Object.fromEntries(
  [...builtIn, ...generated].map((v) => [v.id, v]),
);
