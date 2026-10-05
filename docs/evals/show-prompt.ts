/**
 * Prints what the model sees for a variant: the system prompt and the first input (worker reply
 * with its reminder) for a case. Use it to check a new variant renders as intended.
 *   node show-prompt.ts <variant> [case-id] [--system-only]
 */
import { loadCases } from './lib/data.ts';
import { seedHistory } from './lib/drive.ts';
import { buildTools, promptParts, renderMessages } from './lib/prompt.ts';
import { variants } from './variants/index.ts';

const [id, caseId = 'case-03'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const variant = variants[id!];
if (variant === undefined)
  throw new Error(`unknown variant ${id}; known: ${Object.keys(variants).join(', ')}`);
const tools = buildTools(variant.tools);
const system = variant.system(tools, promptParts(tools, variant.speaker));
const c = loadCases().find((x) => x.id === caseId)!;
const messages = renderMessages(
  system,
  seedHistory(c, variant.tools.forwardName),
  tools,
  variant.reminders({ step: 0, segments: 0, last: 'reply' }),
);
console.log(
  `### SYSTEM (${system.length} chars, ~${Math.round(system.length / 4)} tokens)\n${system}`,
);
if (!process.argv.includes('--system-only')) {
  for (const m of messages.slice(1))
    console.log(
      `\n### ${m.role.toUpperCase()}\n${m.content.slice(0, 1500)}${m.content.length > 1500 ? '\n…' : ''}`,
    );
}
