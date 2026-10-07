/**
 * Codex thread items and stored threads as `TranscriptEntry`s. Pure.
 *
 * Agent text becomes `text`; reasoning is left out; commands, file changes, MCP, dynamic tool,
 * web search, image and subagent calls, and subagent starts, become a `toolCall` and its
 * `toolResult`, sharing the item `id`; plans and compaction become `status`. Live user messages are not echoed (the pool
 * records what it sends); stored ones are `prompt`s.
 */
import { capped } from '../content.ts';
import type { TranscriptEntry } from '../schema.ts';
import { errorInfoName, type Item } from './protocol.ts';

/** Items that are a tool call with a result. */
const toolItems: ReadonlySet<string> = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'webSearch',
  'imageView',
  'imageGeneration',
  'collabAgentToolCall',
]);

/**
 * A subagent's start, as Codex reports it in multi-agent mode: shown as a call, so the subagent's
 * entries have a call to nest under.
 */
const isSubagentStart = (item: Item) => item.type === 'subAgentActivity' && item.kind === 'started';

export const isToolItem = (item: Item): boolean =>
  toolItems.has(item.type) || isSubagentStart(item);

/**
 * The subagent threads an item starts: a `spawnAgent` call's receivers, or a started
 * `subAgentActivity`'s thread (the form Codex 0.160.1 emits with current models). Empty for every
 * other item.
 */
export const spawnedThreads = (item: Item): ReadonlyArray<string> => {
  if (item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent') {
    return item.receiverThreadIds ?? [];
  }
  return isSubagentStart(item) && item.agentThreadId ? [item.agentThreadId] : [];
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

/** A tool item's name and input as the transcript shows them. */
const callOf = (item: Item): { readonly name: string; readonly input: unknown } => {
  switch (item.type) {
    case 'commandExecution':
      return { name: item.type, input: { command: item.command, cwd: item.cwd } };
    case 'fileChange':
      return {
        name: item.type,
        input: {
          changes: (item.changes ?? []).map((change) => ({
            path: change.path,
            kind: change.kind?.type,
          })),
        },
      };
    case 'mcpToolCall':
      return { name: `mcp:${item.server ?? ''}/${item.tool ?? ''}`, input: item.arguments ?? {} };
    case 'dynamicToolCall':
      return {
        name: item.type,
        input: { namespace: item.namespace, tool: item.tool, arguments: item.arguments },
      };
    case 'webSearch':
      return { name: item.type, input: { query: item.query, action: item.action } };
    case 'imageView':
      return { name: item.type, input: { path: item.path } };
    case 'imageGeneration':
      return { name: item.type, input: { revisedPrompt: item.revisedPrompt } };
    case 'subAgentActivity':
      return {
        name: item.type,
        input: { kind: item.kind, agentThreadId: item.agentThreadId, agentPath: item.agentPath },
      };
    default:
      return {
        name: item.type,
        input: {
          tool: item.tool,
          receiverThreadIds: item.receiverThreadIds,
          prompt: item.prompt,
          model: item.model,
          reasoningEffort: item.reasoningEffort,
        },
      };
  }
};

/** The text parts of MCP content blocks, else the blocks as JSON. */
const mcpText = (result: unknown): string => {
  if (!isRecord(result)) return '';
  const content = result['content'];
  if (!Array.isArray(content)) return JSON.stringify(result);
  const texts = content.flatMap((block: unknown) =>
    isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string'
      ? [block['text']]
      : [],
  );
  return texts.length === content.length ? texts.join('\n') : JSON.stringify(content);
};

const failedStatus = (item: Item) => item.status === 'failed' || item.status === 'declined';

/** A tool item's result text and whether it failed. */
const resultOf = (item: Item): { readonly content: string; readonly isError: boolean } => {
  switch (item.type) {
    case 'commandExecution':
      return {
        content: item.aggregatedOutput ?? '',
        isError: failedStatus(item) || (typeof item.exitCode === 'number' && item.exitCode !== 0),
      };
    case 'fileChange':
      return {
        content: (item.changes ?? []).map((change) => change.diff ?? '').join('\n'),
        isError: failedStatus(item),
      };
    case 'mcpToolCall':
      return {
        content: item.error?.message ?? mcpText(item.result),
        isError: failedStatus(item) || (item.error !== undefined && item.error !== null),
      };
    case 'dynamicToolCall':
      return {
        content: (item.contentItems ?? []).flatMap((part) => part.text ?? []).join('\n'),
        isError: failedStatus(item) || item.success === false,
      };
    case 'imageGeneration':
      return {
        content: item.savedPath ?? '',
        isError: failedStatus(item) || (item.failure !== undefined && item.failure !== null),
      };
    case 'collabAgentToolCall':
      return {
        content: Object.entries(item.agentsStates ?? {})
          .flatMap(([thread, state]) =>
            state === undefined
              ? []
              : [`${thread}: ${state.status}${state.message ? `\n${state.message}` : ''}`],
          )
          .join('\n\n'),
        isError: failedStatus(item),
      };
    default:
      return { content: '', isError: failedStatus(item) };
  }
};

export const toolCall = (item: Item, parentToolUseId: string | null): TranscriptEntry => {
  const { name, input } = callOf(item);
  const text = capped(JSON.stringify(input ?? {}));
  return {
    _tag: 'toolCall',
    parentToolUseId,
    toolUseId: item.id,
    name,
    input: text.text,
    truncated: text.truncated,
  };
};

export const toolResult = (item: Item, parentToolUseId: string | null): TranscriptEntry => {
  const { content, isError } = resultOf(item);
  const text = capped(content);
  return {
    _tag: 'toolResult',
    parentToolUseId,
    toolUseId: item.id,
    content: text.text,
    truncated: text.truncated,
    isError,
  };
};

/** A user message's text parts, joined by blank lines. */
const promptText = (item: Item): string =>
  (item.content ?? [])
    .flatMap((part) =>
      isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string'
        ? [part['text']]
        : [],
    )
    .join('\n\n');

/**
 * The entries of a finished item other than a tool call (those take a call and a result):
 * text, plan and compaction status, and, for stored history only (`prompts`), user prompts.
 */
export const completedEntries = (
  item: Item,
  parentToolUseId: string | null,
  prompts: boolean,
): ReadonlyArray<TranscriptEntry> => {
  switch (item.type) {
    case 'agentMessage':
      return item.text ? [{ _tag: 'text', parentToolUseId, text: item.text }] : [];
    case 'plan':
      return item.text ? [{ _tag: 'status', parentToolUseId, text: item.text }] : [];
    case 'contextCompaction':
      return [{ _tag: 'status', parentToolUseId, text: 'Context compacted.' }];
    case 'userMessage': {
      const text = promptText(item);
      return prompts && text !== ''
        ? [{ _tag: 'prompt', parentToolUseId, source: 'earlier', text }]
        : [];
    }
    default:
      return [];
  }
};

/** A `turn/plan/updated` as one status line per step, after its explanation. */
export const planStatus = (
  explanation: string | undefined,
  plan: ReadonlyArray<{ readonly step: string; readonly status: string }>,
): string =>
  [
    ...(explanation ? [explanation] : []),
    ...plan.map(({ step, status }) => `[${status}] ${step}`),
  ].join('\n');

/**
 * How a main-thread turn ended: `success`, `interrupted`, else Codex's own error name (falling back
 * to `failed`), uninterpreted. `resetsAt` is attached to `usageLimitExceeded` when known.
 */
export const turnEnd = (
  status: string,
  errorInfo: unknown,
  resetsAt: number | undefined,
): TranscriptEntry => {
  if (status === 'completed') return { _tag: 'turnEnd', parentToolUseId: null, outcome: 'success' };
  if (status === 'interrupted') {
    return { _tag: 'turnEnd', parentToolUseId: null, outcome: 'interrupted' };
  }
  const outcome = errorInfoName(errorInfo) ?? 'failed';
  return outcome === 'usageLimitExceeded' && resetsAt !== undefined
    ? { _tag: 'turnEnd', parentToolUseId: null, outcome, resetsAt }
    : { _tag: 'turnEnd', parentToolUseId: null, outcome };
};

/**
 * A stored thread and its subagents as entries. `threads` holds every thread's items in order,
 * by thread ID. Each subagent's entries come right after the item that started it
 * (before that call's result), nested under it. No `turnEnd` is invented, as for Claude Code.
 */
export const historyEntries = (
  mainThreadId: string,
  threads: ReadonlyMap<string, ReadonlyArray<Item>>,
): ReadonlyArray<TranscriptEntry> => {
  const rendered = new Set<string>();
  const render = (
    threadId: string,
    parentToolUseId: string | null,
  ): ReadonlyArray<TranscriptEntry> => {
    // A thread is shown once, even if several calls name it.
    if (rendered.has(threadId)) return [];
    rendered.add(threadId);
    return (threads.get(threadId) ?? []).flatMap((item): ReadonlyArray<TranscriptEntry> =>
      isToolItem(item)
        ? [
            toolCall(item, parentToolUseId),
            ...spawnedThreads(item).flatMap((child) => render(child, item.id)),
            toolResult(item, parentToolUseId),
          ]
        : completedEntries(item, parentToolUseId, true),
    );
  };
  return render(mainThreadId, null);
};

/**
 * A stored main thread's last answer: every agent message after its last user message, joined by
 * blank lines (the same rule as for Claude Code), or `undefined` when there is none.
 */
export const lastAnswer = (items: ReadonlyArray<Item>): string | undefined => {
  const start = items.findLastIndex((item) => item.type === 'userMessage');
  const answer = items
    .slice(start + 1)
    .flatMap((item) => (item.type === 'agentMessage' && item.text ? [item.text] : []))
    .join('\n\n');
  return answer === '' ? undefined : answer;
};
