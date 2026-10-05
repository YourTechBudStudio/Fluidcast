/** Loads the case suite (all case files) and the gold references (all gold files). */
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import type { Case } from './drive.ts';

const base = new URL('../cases/', import.meta.url).pathname;

const jsonl = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));

/** candidate-cases.jsonl plus any cases/extra-*.jsonl added later. */
export const loadCases = (): Array<Case> => [
  ...jsonl(`${base}candidate-cases.jsonl`),
  ...readdirSync(base)
    .filter((f) => /^extra-.*\.jsonl$/.test(f))
    .flatMap((f) => jsonl(`${base}${f}`)),
];

export type Gold = {
  id: string;
  points: Array<{ id: string; text: string; weight: 'core' | 'detail' }>;
  questions: Array<{ id: string; text: string; options?: Array<string> }>;
  verbatim: Array<string>;
  quiz: Array<{ q: string; a: string }>;
  gist: string;
};

export const loadGold = (): Map<string, Gold> =>
  new Map(
    readdirSync(base)
      .filter((f) => /^gold-.*\.jsonl$/.test(f))
      .flatMap((f) => (existsSync(`${base}${f}`) ? jsonl(`${base}${f}`) : []))
      .map((g: Gold) => [g.id, g]),
  );

/** Resolves a case spec: comma-separated set names (cases/sets.json) and/or case ids. */
export const resolveCases = (spec: string): Array<string> => {
  const sets: Record<string, Array<string>> = JSON.parse(readFileSync(`${base}sets.json`, 'utf8'));
  return [...new Set(spec.split(',').flatMap((token) => sets[token] ?? [token]))];
};
