/**
 * Blind pairwise preference between two variants on shared (case, rep) runs.
 *
 *   node pairwise.ts prep  --tag dev --a champ --b cand --name r1-pair --batches 3 [--cases dev]
 *   node pairwise.ts score --name r1-pair
 *
 * Each packet shows the worker reply and walkthroughs X and Y (order alternates by hash). The judge
 * writes `<packet>.json`: {"winner":"X"|"Y"|"tie","strength":1|2|3,"fidelity":"X"|"Y"|"same","why":"..."}.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { loadCases, resolveCases } from './lib/data.ts';
import type { Run } from './lib/drive.ts';
import { renderRun } from './lib/render.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tag: { type: 'string' },
    model: { type: 'string', default: 'qwen' },
    a: { type: 'string' },
    b: { type: 'string' },
    name: { type: 'string' },
    batches: { type: 'string', default: '3' },
    cases: { type: 'string' },
  },
});
const root = `judging/${values.name}`;

if (positionals[0] === 'prep') {
  const cases = new Map(loadCases().map((c) => [c.id, c]));
  const filter = values.cases ? new Set(resolveCases(values.cases)) : undefined;
  const dirA = `out/${values.tag}/${values.model}/${values.a}`;
  const dirB = `out/${values.tag}/${values.model}/${values.b}`;
  const manifest: Record<string, { a: string; b: string; key: string; xIsA: boolean }> = {};
  const files = readdirSync(dirB).filter(
    (f) => /\.r\d+\.json$/.test(f) && existsSync(`${dirA}/${f}`),
  );
  let i = 0;
  for (const f of files.sort()) {
    const runA = JSON.parse(readFileSync(`${dirA}/${f}`, 'utf8')) as Run;
    const runB = JSON.parse(readFileSync(`${dirB}/${f}`, 'utf8')) as Run;
    if (filter && !filter.has(runA.caseId)) continue;
    const c = cases.get(runA.caseId)!;
    const id = createHash('sha256').update(`${values.name}/${f}`).digest('hex').slice(0, 10);
    const xIsA = parseInt(id.slice(0, 2), 16) % 2 === 0;
    const [x, y] = xIsA ? [runA, runB] : [runB, runA];
    manifest[id] = { a: values.a!, b: values.b!, key: f.replace(/\.json$/, ''), xIsA };
    const dir = `${root}/batch-${(i++ % Number(values.batches)) + 1}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/${id}.md`,
      [
        `# Pair ${id}`,
        'Compare with docs/evals/pairwise-rubric.md.',
        `\n## The worker's original reply\n\n${c.workerReply}`,
        `\n## Walkthrough X\n${renderRun(x)}`,
        `\n## Walkthrough Y\n${renderRun(y)}`,
      ].join('\n'),
    );
  }
  mkdirSync(root, { recursive: true });
  writeFileSync(`${root}/manifest.json`, JSON.stringify(manifest, null, 1));
  console.log(`${Object.keys(manifest).length} pairs under ${root}`);
} else if (positionals[0] === 'score') {
  const manifest: Record<string, { a: string; b: string; key: string; xIsA: boolean }> = JSON.parse(
    readFileSync(`${root}/manifest.json`, 'utf8'),
  );
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  let weighted = 0;
  let fidA = 0;
  let fidB = 0;
  let n = 0;
  const why: Array<string> = [];
  const perCase: Record<string, { a: number; b: number }> = {};
  for (const batch of readdirSync(root).filter((d) => d.startsWith('batch-'))) {
    for (const f of readdirSync(`${root}/${batch}`).filter((name) => name.endsWith('.json'))) {
      const id = f.replace(/\.json$/, '');
      const m = manifest[id];
      if (!m) continue;
      const text = readFileSync(`${root}/${batch}/${f}`, 'utf8');
      const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const winner = j.winner === 'tie' ? 'tie' : (j.winner === 'X') === m.xIsA ? 'a' : 'b';
      const fid = j.fidelity === 'same' ? 'same' : (j.fidelity === 'X') === m.xIsA ? 'a' : 'b';
      n++;
      if (winner === 'a') aWins++;
      else if (winner === 'b') bWins++;
      else ties++;
      weighted += winner === 'tie' ? 0 : (winner === 'b' ? 1 : -1) * (j.strength ?? 1);
      if (fid === 'a') fidA++;
      if (fid === 'b') fidB++;
      why.push(`${m.key} → ${winner === 'tie' ? 'tie' : winner === 'a' ? m.a : m.b}: ${j.why}`);
      const caseId = m.key.replace(/\.r\d+$/, '');
      const c = (perCase[caseId] ??= { a: 0, b: 0 });
      if (winner === 'a') c.a++;
      if (winner === 'b') c.b++;
    }
  }
  const first = Object.values(manifest)[0];
  console.log(
    `${first?.b} vs ${first?.a}: n=${n}, ${first?.b} wins ${bWins}, ${first?.a} wins ${aWins}, ties ${ties}; win rate ${(bWins / Math.max(1, aWins + bWins)).toFixed(2)}; strength-weighted ${(weighted / Math.max(1, n)).toFixed(2)} (−3..3, + favors ${first?.b}); fidelity better: ${first?.b} ${fidB}, ${first?.a} ${fidA}`,
  );
  const cases = Object.values(perCase);
  console.log(
    `per case (majority of reps): ${first?.b} ${cases.filter((c) => c.b > c.a).length}, ${first?.a} ${cases.filter((c) => c.a > c.b).length}, split ${cases.filter((c) => c.a === c.b).length}`,
  );
  writeFileSync(`${root}/summary.txt`, why.join('\n'));
}
