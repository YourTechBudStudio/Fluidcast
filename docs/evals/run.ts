/**
 * Runs variants over cases. Each case's generations run back to back (its prefix grows, so the
 * server's prefix cache is reused); cases run concurrently up to --conc. Tasks are ordered variant
 * by variant so one system prompt is hot at a time.
 *
 *   node run.ts --variants d1-ask,d1-nat --cases screen --reps 2 --conc 6 --tag r1 [--model sol]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { loadCases, resolveCases } from './lib/data.ts';
import { driveCase, type Case } from './lib/drive.ts';
import { variants } from './variants/index.ts';

const { values } = parseArgs({
  options: {
    variants: { type: 'string' },
    cases: { type: 'string', default: 'screen' },
    reps: { type: 'string', default: '1' },
    conc: { type: 'string', default: '6' },
    tag: { type: 'string', default: 'dev' },
    model: { type: 'string', default: 'qwen' },
    effort: { type: 'string', default: 'medium' },
    temperature: { type: 'string', default: '0.3' },
    force: { type: 'boolean', default: false },
  },
});

const all: Array<Case> = loadCases();
const wanted = resolveCases(values.cases!);
const cases = values.cases === 'all' ? all : all.filter((c) => wanted.includes(c.id));
const chosen = values.variants!.split(',').map((id) => {
  const variant = variants[id];
  if (variant === undefined) throw new Error(`unknown variant ${id}`);
  return variant;
});
const reps = Number(values.reps);
const model = values.model as 'qwen' | 'sol' | 'luna';

type Task = () => Promise<void>;
const tasks: Array<Task> = [];
let done = 0;
let total = 0;
for (const variant of chosen) {
  const dir = `out/${values.tag}/${model}/${variant.id}`;
  mkdirSync(dir, { recursive: true });
  for (let rep = 1; rep <= reps; rep++) {
    for (const c of cases) {
      const file = `${dir}/${c.id}.r${rep}.json`;
      // Skip finished runs; redo runs that ended in a provider error (e.g. a server restart).
      if (
        !values.force &&
        existsSync(file) &&
        JSON.parse(readFileSync(file, 'utf8')).end !== 'error'
      )
        continue;
      total++;
      tasks.push(async () => {
        const run = await driveCase(variant, c, rep, {
          model,
          temperature: model === 'qwen' ? Number(values.temperature) : undefined,
          reasoningEffort: values.effort as 'medium',
          ...variant.model,
        });
        writeFileSync(file, JSON.stringify(run, null, 1));
        done++;
        const secs = run.steps.map((s) => (s.generation.totalMs / 1000).toFixed(1)).join(' ');
        console.log(
          `[${done}/${total}] ${variant.id} ${c.id} r${rep}: ${run.end} after ${run.steps.length} steps (${secs}s)`,
        );
      });
    }
  }
}

const concurrency = Number(values.conc);
let next = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < tasks.length) await tasks[next++]!();
  }),
);
console.log(`done: ${done} runs`);
