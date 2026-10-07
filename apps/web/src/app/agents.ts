import type { Agent } from '@fluidcast/app-contract';

/** The mode screen's agent pills, with their short labels. */
export const AGENT_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
] as const satisfies ReadonlyArray<{ readonly value: Agent; readonly label: string }>;

/** Each agent's full product name, for prose: hints, screen-reader text and failure lines. */
export const AGENT_NAME: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex' };
