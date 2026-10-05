import type { Variant } from '../../lib/drive.ts';
// Post-loop check: no product name in the prompt; one neutral sentence says who is behind `forward`.
import champion from './r9-b-midinvite.ts';

export const agentSentence =
  " Behind `forward` is the agent that does the assistant's real thinking and work: it reads, reasons, decides and acts. You are its voice: its replies are your own work.";

/** The champion's system prompt without the Claude Code <instructions>, plus the agent sentence in the role. */
export const withAgentSentence = (system: string): string => {
  const anchor = 'every `show` appears on their screen.';
  if (!system.includes(anchor)) throw new Error('role anchor not found');
  return system
    .replace(/\n\n<instructions>\n[\s\S]*?\n<\/instructions>/, '')
    .replace(anchor, `${anchor}${agentSentence}`);
};

const variant: Variant = {
  ...champion,
  id: 'ag-a-sentence',
  notes:
    'parent: r9-b-midinvite. Change: (a) the <instructions> block ("The assistant you are the voice of is Claude Code…" and the code-on-screen line) removed; (b) one role sentence after "every `show` appears on their screen.": "Behind `forward` is the agent that does the assistant\'s real thinking and work: it reads, reasons, decides and acts. You are its voice: its replies are your own work."; (c) forward tool rule: "hands the agent your conversation since the last `forward`" (was "hands your work the conversation"). Nothing else changes.',
  tools: {
    ...champion.tools,
    forward: [
      '`forward` (just `{"type":"forward"}`, no fields) hands the agent your conversation since the last `forward`, including the listener\'s answers.',
    ],
  },
  system: (tools, parts) => withAgentSentence(champion.system(tools, parts)),
};
export default variant;
