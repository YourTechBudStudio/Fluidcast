// MOCK ONLY. Pure presentation model over worker transcript entries (program-design §9.3 `workers/transcript.ts`).

import type { TranscriptEntry } from './fixtures';

type Entry<T extends TranscriptEntry['_tag']> = Extract<TranscriptEntry, { _tag: T }>;

/** `running`: the last unresolved top-level call of a working worker. `open`: no result and not running. */
export type ToolState = 'running' | 'ok' | 'error' | 'open';

export type TranscriptNode =
  | {
      readonly kind: 'prompt';
      readonly key: string;
      readonly source: 'fluidcast' | 'earlier';
      readonly text: string;
    }
  | { readonly kind: 'text'; readonly key: string; readonly text: string }
  | { readonly kind: 'status'; readonly key: string; readonly text: string }
  | {
      /** A tool call with its result folded in; a result is never a node of its own. */
      readonly kind: 'tool';
      readonly key: string;
      readonly call: Entry<'toolCall'>;
      readonly result: Entry<'toolResult'> | undefined;
      readonly state: ToolState;
      /** Entries nested under this call (a subagent's steps). */
      readonly children: ReadonlyArray<TranscriptNode>;
    }
  | { readonly kind: 'turnEnd'; readonly key: string; readonly outcome: string };

export interface Turn {
  readonly key: string;
  readonly nodes: ReadonlyArray<TranscriptNode>;
  /** The turn's recorded outcome; `undefined` for earlier history and a turn still running. */
  readonly outcome: string | undefined;
  readonly running: boolean;
}

/** Nests entries under the tool call that started them and pairs each call with its result. */
export const transcriptTree = (
  entries: ReadonlyArray<TranscriptEntry>,
  working: boolean,
): TranscriptNode[] => {
  const results = new Map<string, Entry<'toolResult'>>();
  for (const entry of entries) if (entry._tag === 'toolResult') results.set(entry.toolUseId, entry);
  const lastCall = entries.findLast((e) => e._tag === 'toolCall' && e.parentToolUseId === null);

  const build = (parent: string | null): TranscriptNode[] =>
    entries.flatMap((entry, i): TranscriptNode[] => {
      if (entry.parentToolUseId !== parent) return [];
      const key = `${i}`;
      switch (entry._tag) {
        case 'prompt':
          return [{ kind: 'prompt', key, source: entry.source, text: entry.text }];
        case 'text':
          return [{ kind: 'text', key, text: entry.text }];
        case 'status':
          return [{ kind: 'status', key, text: entry.text }];
        case 'turnEnd':
          return [{ kind: 'turnEnd', key, outcome: entry.outcome }];
        case 'toolResult':
          return [];
        case 'toolCall': {
          const result = results.get(entry.toolUseId);
          const state: ToolState =
            result !== undefined
              ? result.isError
                ? 'error'
                : 'ok'
              : working && entry === lastCall
                ? 'running'
                : 'open';
          const children = build(entry.toolUseId);
          return [{ kind: 'tool', key, call: entry, result, state, children }];
        }
      }
    });
  return build(null);
};

/** Splits the top level into turns: a prompt opens one, and so does anything after an ended turn (an automatic turn). */
export const turns = (nodes: ReadonlyArray<TranscriptNode>, working: boolean): Turn[] => {
  const out: { key: string; nodes: TranscriptNode[]; outcome: string | undefined }[] = [];
  for (const node of nodes) {
    if (node.kind === 'prompt' || out.length === 0 || out.at(-1)!.outcome !== undefined) {
      out.push({ key: node.key, nodes: [], outcome: undefined });
    }
    const turn = out.at(-1)!;
    if (node.kind === 'turnEnd') turn.outcome = node.outcome;
    else turn.nodes.push(node);
  }
  return out.map((turn, i) => ({
    ...turn,
    running: working && i === out.length - 1 && turn.outcome === undefined,
  }));
};

const PREFERRED = ['command', 'file_path', 'pattern', 'query', 'url', 'description'] as const;

/** One line for a tool call: its most telling argument, else compact JSON; 80 characters. */
export const shortInput = (input: string): string => {
  let text = input;
  try {
    const value = JSON.parse(input) as Record<string, unknown>;
    const key = PREFERRED.find((k) => typeof value[k] === 'string');
    if (key) text = value[key] as string;
  } catch {
    // Not JSON: keep the raw text.
  }
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/** The text inside `<instruction>` when present, else the prompt; whitespace collapsed. */
export const instructionPreview = (prompt: string): string => {
  const instruction = /<instruction>\s*([\s\S]*?)\s*<\/instruction>/.exec(prompt)?.[1];
  return (instruction ?? prompt).replace(/\s+/g, ' ').trim();
};

export const prettyInput = (input: string): string => {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
};

export const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length);

export const outcomeLabel = (outcome: string) =>
  outcome === 'success' ? 'Turn ended' : `Turn ended: ${outcome}`;
