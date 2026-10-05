/**
 * Copies judges' packet results back next to their runs, validating the shape.
 *   node judge-ingest.ts --name r1-screen
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { name: { type: 'string' } } });
const rubric = readFileSync('judge-rubric.md', 'utf8').match(/rubric (v[\d.]+)/)?.[1] ?? 'v?';
const root = `judging/${values.name}`;
const manifest: Record<string, string> = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'));
const results = new Map<string, string>();
for (const batch of readdirSync(root).filter((d) => d.startsWith('batch-'))) {
  for (const f of readdirSync(`${root}/${batch}`).filter((name) => name.endsWith('.json'))) {
    results.set(f.replace(/\.json$/, ''), `${root}/${batch}/${f}`);
  }
}
const required = [
  'points',
  'questions',
  'additions',
  'burden',
  'screens',
  'speech',
  'pacing',
  'speed',
  'engagement',
  'overall',
  'flags',
];
let ok = 0;
const missing: Array<string> = [];
const bad: Array<string> = [];
for (const [id, target] of Object.entries(manifest)) {
  const source = results.get(id);
  if (source === undefined) {
    if (!existsSync(target)) missing.push(id);
    continue;
  }
  try {
    const text = readFileSync(source, 'utf8');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const absent = required.filter((k) => !(k in json));
    if (absent.length > 0) throw new Error(`missing ${absent.join(',')}`);
    writeFileSync(target, JSON.stringify({ ...json, rubric }, null, 1));
    ok++;
  } catch (error) {
    bad.push(`${id}: ${String(error).slice(0, 100)}`);
  }
}
console.log(
  `ingested ${ok}; missing ${missing.length}${missing.length ? ` (${missing.join(' ')})` : ''}; invalid ${bad.length}`,
);
for (const b of bad) console.log(`  invalid ${b}`);
