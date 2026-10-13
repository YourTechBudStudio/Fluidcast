import type { TranscriptEntry } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

/** Pure presentation model over a worker's transcript entries. */

type Entry<T extends TranscriptEntry['_tag']> = Extract<TranscriptEntry, { _tag: T }>;

/** `running`: the last unresolved top-level call of a working worker. `open`: no result, and not running. */
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
      /** The last top-level call without a result: the one a working worker is running. */
      readonly lastUnresolved: boolean;
      /** Entries nested under this call (a subagent's steps). */
      readonly children: ReadonlyArray<TranscriptNode>;
    }
  | {
      readonly kind: 'turnEnd';
      readonly key: string;
      readonly outcome: string;
      readonly resetsAt: number | undefined;
    };

export type ToolNode = Extract<TranscriptNode, { kind: 'tool' }>;

/**
 * Nests entries under the tool call whose `toolUseId` is their `parentToolUseId` (orphans stay at the top level) and
 * pairs each call with its result. Keys are entry positions, which never change because entries are only appended.
 */
export const transcriptTree = (entries: ReadonlyArray<TranscriptEntry>): TranscriptNode[] => {
  const results = new Map<string, Entry<'toolResult'>>();
  const calls = new Set<string>();
  for (const entry of entries) {
    if (entry._tag === 'toolResult') results.set(entry.toolUseId, entry);
    if (entry._tag === 'toolCall') calls.add(entry.toolUseId);
  }
  // An entry whose parent call is not in the transcript is shown at the top level rather than lost.
  const parentOf = (entry: TranscriptEntry) =>
    entry.parentToolUseId !== null && calls.has(entry.parentToolUseId)
      ? entry.parentToolUseId
      : null;
  const lastUnresolved = entries.findLast(
    (entry): entry is Entry<'toolCall'> =>
      entry._tag === 'toolCall' && parentOf(entry) === null && !results.has(entry.toolUseId),
  );

  // One pass indexes every entry under its parent, so building the tree is linear in the entries.
  const byParent = new Map<string | null, Array<[TranscriptEntry, number]>>();
  entries.forEach((entry, i) => {
    const parent = parentOf(entry);
    const siblings = byParent.get(parent);
    if (siblings) siblings.push([entry, i]);
    else byParent.set(parent, [[entry, i]]);
  });

  const build = (parent: string | null): TranscriptNode[] =>
    (byParent.get(parent) ?? []).flatMap(([entry, i]): TranscriptNode[] => {
      const key = `${i}`;
      switch (entry._tag) {
        case 'prompt':
          return [{ kind: 'prompt', key, source: entry.source, text: entry.text }];
        case 'text':
          return [{ kind: 'text', key, text: entry.text }];
        case 'status':
          return [{ kind: 'status', key, text: entry.text }];
        case 'turnEnd':
          return [{ kind: 'turnEnd', key, outcome: entry.outcome, resetsAt: entry.resetsAt }];
        case 'toolResult':
          // Its call's node holds it; a result whose call is missing has nothing to fold into.
          return [];
        case 'toolCall':
          return [
            {
              kind: 'tool',
              key,
              call: entry,
              result: results.get(entry.toolUseId),
              lastUnresolved: entry === lastUnresolved,
              children: build(entry.toolUseId),
            },
          ];
      }
    });
  return build(null);
};

/** Where a tool call stands. */
export const toolState = (node: ToolNode, working: boolean): ToolState => {
  if (node.result !== undefined) return node.result.isError ? 'error' : 'ok';
  return working && node.lastUnresolved ? 'running' : 'open';
};

export interface Turn {
  readonly key: string;
  readonly nodes: ReadonlyArray<TranscriptNode>;
  /** The recorded end, if there is one: earlier history has none, and neither has a turn still running. */
  readonly end: Extract<TranscriptNode, { kind: 'turnEnd' }> | undefined;
}

/**
 * Splits the top level into turns. A prompt starts one, and a turn ends after its `turnEnd`, so output after an ended
 * turn (an automatic turn) starts another. Earlier history has no `turnEnd`, so its turns are bounded by prompts only.
 */
export const turns = (tree: ReadonlyArray<TranscriptNode>): Turn[] => {
  const out: Array<{ key: string; nodes: TranscriptNode[]; end: Turn['end'] }> = [];
  for (const node of tree) {
    const current = out.at(-1);
    if (node.kind === 'prompt' || current === undefined || current.end !== undefined) {
      out.push({ key: node.key, nodes: [], end: undefined });
    }
    const turn = out.at(-1)!;
    if (node.kind === 'turnEnd') turn.end = node;
    else turn.nodes.push(node);
  }
  return out;
};

const PREFERRED = ['command', 'file_path', 'pattern', 'query', 'url', 'description'] as const;

/** One line for a tool call: its most telling argument, else its compact JSON; at most 80 characters. */
export const shortInput = (input: string): string => {
  let text = input;
  try {
    const value: unknown = JSON.parse(input);
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      const key = PREFERRED.find((name) => typeof record[name] === 'string');
      text = key === undefined ? JSON.stringify(value) : (record[key] as string);
    }
  } catch {
    // Not JSON (for example, cut at the cap): keep the raw text.
  }
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/** The text inside `<instruction>` when present, else the whole prompt; whitespace collapsed. */
export const instructionPreview = (prompt: string): string => {
  const instruction = /<instruction>\s*([\s\S]*?)\s*<\/instruction>/.exec(prompt)?.[1];
  return (instruction ?? prompt).replace(/\s+/g, ' ').trim();
};

/** A tool call's input as indented JSON, or as sent when it is not valid JSON. */
export const prettyInput = (input: string): string => {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
};

export const lineCount = (text: string): number => (text === '' ? 0 : text.split('\n').length);
