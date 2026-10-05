/** Renders a run as the listener experiences it: speech, screens, questions, their inputs. */
import type { Run } from './drive.ts';

export const renderRun = (run: Run, options: { timings?: boolean } = {}): string => {
  const lines: Array<string> = [];
  for (const step of run.steps) {
    const t = step.generation;
    lines.push(
      `\n=== Response ${step.step}${options.timings ? ` (first action ${((t.firstActionMs ?? 0) / 1000).toFixed(1)}s, total ${(t.totalMs / 1000).toFixed(1)}s)` : ''} ===`,
    );
    if (step.invalid.length > 0) lines.push(`[INVALID OUTPUT: ${step.invalid.join(', ')}]`);
    for (const e of step.elements) {
      switch (e.type) {
        case 'speak':
          lines.push(`VOICE: ${e.text}`);
          break;
        case 'show':
          lines.push(
            `SCREEN (${e.format}${e.title ? `, "${e.title}"` : ''}):\n${String(e.content)
              .split('\n')
              .map((l) => `    ${l}`)
              .join('\n')}`,
          );
          break;
        case 'ask': {
          const labels = Array.isArray(e.options)
            ? ` [${(e.options as Array<{ label: string; description?: string }>).map((o) => o.label + (o.description ? ` — ${o.description}` : '')).join(' | ')}]`
            : '';
          lines.push(`QUESTION (${e.kind}): ${e.question}${labels}`);
          break;
        }
        case 'forward':
          lines.push('[FORWARD to the work]');
          break;
        default:
          lines.push(`[${e.type}] ${JSON.stringify(e)}`);
      }
    }
    if (step.sim) lines.push(`LISTENER (${step.sim.kind}): ${step.sim.text}`);
  }
  lines.push(`\n[end: ${run.end}]`);
  return lines.join('\n');
};

if (import.meta.main) {
  const { readFileSync } = await import('node:fs');
  for (const file of process.argv.slice(2)) {
    const run = JSON.parse(readFileSync(file, 'utf8')) as Run;
    console.log(`##### ${run.variant} ${run.caseId} r${run.rep} (${run.model})`);
    console.log(renderRun(run, { timings: true }));
  }
}
