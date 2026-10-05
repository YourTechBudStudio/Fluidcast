/**
 * Builds blinded judge packets for runs that have no judgment yet. Each packet is one Markdown
 * file (rubric pointer, worker reply, gold, transcript); the judge writes `<packet>.json` beside
 * it. The manifest maps packets back to runs. Packets are split into N batch folders, one per judge.
 *
 *   node judge-prep.ts --tag screen --variants a,b --batches 3 --name r1-screen [--cases screen]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { loadCases, loadGold, resolveCases } from './lib/data.ts';
import type { Case, Run } from './lib/drive.ts';
import { renderRun } from './lib/render.ts';

const { values } = parseArgs({
  options: {
    tag: { type: 'string' },
    model: { type: 'string', default: 'qwen' },
    variants: { type: 'string' },
    cases: { type: 'string' },
    batches: { type: 'string', default: '3' },
    name: { type: 'string' },
  },
});

const cases = new Map(loadCases().map((c) => [c.id, c]));
const gold = loadGold();
const caseFilter = values.cases ? new Set(resolveCases(values.cases)) : undefined;
const root = `judging/${values.name}`;
// Judgments made under an older rubric are stale: re-judge them so every compared run shares one rubric.
const rubric = readFileSync('judge-rubric.md', 'utf8').match(/rubric (v[\d.]+)/)?.[1] ?? 'v?';
const fresh = (path: string) =>
  existsSync(path) &&
  (JSON.parse(readFileSync(path, 'utf8')) as { rubric?: string }).rubric === rubric;
const manifest: Record<string, string> = {};
const packets: Array<{ id: string; body: string }> = [];

for (const variant of values.variants!.split(',')) {
  const dir = `out/${values.tag}/${values.model}/${variant}`;
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => /\.r\d+\.json$/.test(f))) {
    const runPath = `${dir}/${file}`;
    const judgmentPath = runPath.replace(/\.json$/, '.judge.json');
    if (fresh(judgmentPath)) continue;
    const run = JSON.parse(readFileSync(runPath, 'utf8')) as Run;
    if (caseFilter && !caseFilter.has(run.caseId)) continue;
    const c = cases.get(run.caseId) as Case;
    const g = gold.get(run.caseId);
    if (g === undefined) continue;
    const id = createHash('sha256').update(runPath).digest('hex').slice(0, 10);
    manifest[id] = judgmentPath;
    packets.push({
      id,
      body: [
        `# Packet ${id}`,
        'Judge with the rubric in docs/evals/judge-rubric.md.',
        `\n## Context before the reply (for orientation only)\n${c.contextSummary ?? ''}\nListener's message: ${c.priorUserMessage.slice(0, 800)}`,
        `\n## The worker's original reply\n\n${c.workerReply}`,
        `\n## Gold reference\n\n\`\`\`json\n${JSON.stringify(g, null, 1)}\n\`\`\``,
        `\n## The walkthrough\n${renderRun(run)}`,
      ].join('\n'),
    });
  }
}

const batches = Number(values.batches);
packets.sort((a, b) => a.id.localeCompare(b.id));
packets.forEach((p, i) => {
  const dir = `${root}/batch-${(i % batches) + 1}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${p.id}.md`, p.body);
});
mkdirSync(root, { recursive: true });
const previous = existsSync(`${root}/manifest.json`)
  ? JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'))
  : {};
writeFileSync(`${root}/manifest.json`, JSON.stringify({ ...previous, ...manifest }, null, 1));
console.log(
  `${packets.length} packets in ${Math.min(batches, packets.length)} batches under ${root}`,
);
