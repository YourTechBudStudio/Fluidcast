import type { Variant } from '../../lib/drive.ts';
import type { Example } from '../../lib/prompt.ts';
import { withAgentSentence } from './ag-a-sentence.ts';
// Post-loop check: as ag-a-sentence, with the tool renamed `forward_agent`.
import champion from './r9-b-midinvite.ts';

const NAME = 'forward_agent';
const rename = (text: string) =>
  text
    .replaceAll('`forward`', `\`${NAME}\``)
    .replaceAll('{"type":"forward"}', `{"type":"${NAME}"}`);
const renameSteps = (example: Example): Example =>
  (example as unknown as Array<Record<string, unknown>>).map((step) =>
    step.tool === 'forward' ? { ...step, tool: NAME } : step,
  ) as unknown as Example;

const variant: Variant = {
  ...champion,
  id: 'ag-b-forwardagent',
  notes:
    'parent: ag-a-sentence. Change: the forward tool is named `forward_agent` everywhere the model sees it (tool type, examples, role, rules, reminders). Nothing else changes.',
  tools: {
    ...champion.tools,
    forwardName: NAME,
    forward: [
      `\`${NAME}\` (just \`{"type":"${NAME}"}\`, no fields) hands the agent your conversation since the last \`${NAME}\`, including the listener's answers.`,
    ],
  },
  system: (tools, parts) =>
    rename(
      withAgentSentence(
        champion.system(tools, {
          ...parts,
          examples: (exs) => parts.examples(exs.map(renameSteps)),
        }),
      ),
    ),
  reminders: (state) => {
    const base = champion.reminders(state);
    return base === undefined
      ? undefined
      : (event) => {
          const text = base(event);
          return text === undefined ? undefined : rename(text);
        };
  },
};
export default variant;
