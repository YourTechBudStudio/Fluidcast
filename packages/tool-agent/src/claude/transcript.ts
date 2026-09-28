/**
 * Claude Code frames and stored history as `TranscriptEntry`s. Pure.
 *
 * Live frames and stored messages share one block normaliser. Message content is read through
 * small guards because stored messages are untyped (`SessionMessage.message` is `unknown`).
 */
import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';

import type { TranscriptEntry } from '../schema.ts';
import { turnOutcome, type RateLimit } from './failure.ts';

/** The cap on a tool call's input JSON and a tool result's text, in characters. */
export const maxContentLength = 4000;

type Block = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Block => typeof value === 'object' && value !== null;

const blocksOf = (content: unknown): ReadonlyArray<Block> =>
  Array.isArray(content) ? content.filter(isRecord) : [];

const stringField = (block: Block, key: string): string | undefined => {
  const value = block[key];
  return typeof value === 'string' ? value : undefined;
};

const capped = (text: string) =>
  text.length > maxContentLength
    ? { text: text.slice(0, maxContentLength), truncated: true }
    : { text, truncated: false };

/** A `tool_result` block's text: a string, or its text blocks joined. Uncapped. */
const toolResultText = (block: Block): string => {
  const content = block['content'];
  if (typeof content === 'string') return content;
  return blocksOf(content)
    .flatMap((part) => {
      const text = part['type'] === 'text' ? stringField(part, 'text') : undefined;
      return text === undefined ? [] : [text];
    })
    .join('\n');
};

/** Assistant content: text and tool calls; thinking and other blocks are left out. */
const assistantEntries = (
  content: unknown,
  parentToolUseId: string | null,
): ReadonlyArray<TranscriptEntry> =>
  blocksOf(content).flatMap((block): ReadonlyArray<TranscriptEntry> => {
    if (block['type'] === 'text') {
      const text = stringField(block, 'text');
      return text === undefined || text === '' ? [] : [{ _tag: 'text', parentToolUseId, text }];
    }
    const toolUseId = stringField(block, 'id');
    const name = stringField(block, 'name');
    if (block['type'] !== 'tool_use' || toolUseId === undefined || name === undefined) return [];
    const input = capped(JSON.stringify(block['input'] ?? {}));
    return [
      {
        _tag: 'toolCall',
        parentToolUseId,
        toolUseId,
        name,
        input: input.text,
        truncated: input.truncated,
      },
    ];
  });

/**
 * User content: tool results, and, when `prompts` is set (stored history), the prompt text. Live
 * prompts are not re-read from echoes: the pool records what it sends.
 */
const userEntries = (
  content: unknown,
  parentToolUseId: string | null,
  prompts: boolean,
): ReadonlyArray<TranscriptEntry> => {
  if (typeof content === 'string') {
    return prompts ? [{ _tag: 'prompt', parentToolUseId, source: 'earlier', text: content }] : [];
  }
  const blocks = blocksOf(content);
  const text = blocks
    .flatMap((block) => {
      const value = block['type'] === 'text' ? stringField(block, 'text') : undefined;
      return value === undefined ? [] : [value];
    })
    .join('\n\n');
  const prompt: ReadonlyArray<TranscriptEntry> =
    prompts && text !== '' ? [{ _tag: 'prompt', parentToolUseId, source: 'earlier', text }] : [];
  const results = blocks.flatMap((block): ReadonlyArray<TranscriptEntry> => {
    const toolUseId = stringField(block, 'tool_use_id');
    if (block['type'] !== 'tool_result' || toolUseId === undefined) return [];
    const result = capped(toolResultText(block));
    return [
      {
        _tag: 'toolResult',
        parentToolUseId,
        toolUseId,
        content: result.text,
        truncated: result.truncated,
        isError: block['is_error'] === true,
      },
    ];
  });
  return [...prompt, ...results];
};

/**
 * The entries of one live frame. A top-level result becomes its turn's `turnEnd`; `rateLimit` is
 * the rejected rate-limit event seen in that turn, if any. Replayed user messages are left out.
 */
export const frameEntries = (
  frame: SDKMessage,
  rateLimit: RateLimit | undefined,
): ReadonlyArray<TranscriptEntry> => {
  switch (frame.type) {
    case 'assistant':
      return assistantEntries(frame.message.content, frame.parent_tool_use_id);
    case 'user':
      return 'isReplay' in frame && frame.isReplay
        ? []
        : userEntries(frame.message.content, frame.parent_tool_use_id, false);
    case 'result':
      return [{ _tag: 'turnEnd', parentToolUseId: null, ...turnOutcome(frame, rateLimit) }];
    case 'system':
      return frame.subtype === 'task_progress' && frame.summary !== undefined
        ? [{ _tag: 'status', parentToolUseId: frame.tool_use_id ?? null, text: frame.summary }]
        : [];
    default:
      return [];
  }
};

/** A stored message's entries, all with `parentToolUseId` (stored sessions record no results). */
const storedEntries = (
  messages: ReadonlyArray<SessionMessage>,
  parentToolUseId: string | null,
): ReadonlyArray<TranscriptEntry> =>
  messages.flatMap((message) => {
    if (!isRecord(message.message)) return [];
    const content = message.message['content'];
    switch (message.type) {
      case 'assistant':
        return assistantEntries(content, parentToolUseId);
      case 'user':
        return userEntries(content, parentToolUseId, true);
      default:
        return [];
    }
  });

/** Every tool call in stored messages, in order, with its name and its full result text. */
const storedCalls = (messages: ReadonlyArray<SessionMessage>) => {
  const calls: Array<{ readonly toolUseId: string; readonly name: string }> = [];
  const results = new Map<string, string>();
  for (const message of messages) {
    if (!isRecord(message.message)) continue;
    for (const block of blocksOf(message.message['content'])) {
      const id = stringField(block, 'id');
      const name = stringField(block, 'name');
      if (block['type'] === 'tool_use' && id !== undefined && name !== undefined) {
        calls.push({ toolUseId: id, name });
      }
      const answered = stringField(block, 'tool_use_id');
      if (block['type'] === 'tool_result' && answered !== undefined) {
        results.set(answered, toolResultText(block));
      }
    }
  }
  return { calls, results };
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a list's entries live: the main chain (`null`), or a subagent by ID. */
type Owner = string | null;

/**
 * A stored session as entries: the main chain, with each earlier subagent inserted right after the
 * tool call that started it (before that call's result) and its entries nested under that call.
 * No `turnEnd` is invented: stored sessions record no turn results.
 *
 * A subagent's starting call is found by the first rule that matches:
 * 1. the `parent_tool_use_id` its messages report, when that call is in the history (in the main
 *    chain or another subagent, so subagents started by subagents nest under their parent's call);
 * 2. the earliest `Agent` (or older `Task`) call whose result has a line starting with exactly
 *    `agentId: <id>` followed by whitespace or the end of the line. Other tools mention agent IDs
 *    too (`SendMessage` results carry them in JSON), so nothing looser is accepted.
 * 3. Otherwise, including a subagent whose calls lead back to itself, it is shown unlinked: a
 *    top-level `status` line naming it, then its entries at the top level, after the main chain.
 */
export const historyEntries = (
  mainMessages: ReadonlyArray<SessionMessage>,
  subagents: ReadonlyArray<{
    readonly agentId: string;
    readonly messages: ReadonlyArray<SessionMessage>;
  }>,
): ReadonlyArray<TranscriptEntry> => {
  const lists: ReadonlyArray<{
    readonly owner: Owner;
    readonly messages: ReadonlyArray<SessionMessage>;
  }> = [
    { owner: null, messages: mainMessages },
    ...subagents.map(({ agentId, messages }) => ({ owner: agentId, messages })),
  ];
  /** Every call in history order (main chain first), with the list that holds it. */
  const calls = lists.flatMap(({ owner, messages }) => {
    const { calls: found, results } = storedCalls(messages);
    return found.map((call) => ({ ...call, owner, result: results.get(call.toolUseId) }));
  });
  const callOwner = new Map(calls.map((call) => [call.toolUseId, call.owner]));

  const anchorOf = (agentId: string, messages: ReadonlyArray<SessionMessage>) => {
    const reported = messages.find((message) => message.parent_tool_use_id !== null);
    const parent = reported?.parent_tool_use_id;
    if (parent !== undefined && parent !== null && callOwner.has(parent)) return parent;
    const line = new RegExp(`^agentId: ${escapeRegExp(agentId)}(?:\\s|$)`, 'm');
    return calls.find(
      (call) =>
        (call.name === 'Agent' || call.name === 'Task') &&
        call.result !== undefined &&
        line.test(call.result),
    )?.toolUseId;
  };
  const anchors = new Map<string, string>();
  for (const { agentId, messages } of subagents) {
    const anchor = anchorOf(agentId, messages);
    if (anchor !== undefined) anchors.set(agentId, anchor);
  }
  // A subagent whose chain of starting calls leads back to itself cannot be placed.
  const inCycle = (agentId: string) => {
    const seen = new Set<Owner>();
    let owner: Owner | undefined = callOwner.get(anchors.get(agentId)!);
    while (owner !== undefined && owner !== null && !seen.has(owner)) {
      if (owner === agentId) return true;
      seen.add(owner);
      const anchor = anchors.get(owner);
      owner = anchor === undefined ? undefined : callOwner.get(anchor);
    }
    return false;
  };
  for (const agentId of [...anchors.keys()].filter(inCycle)) anchors.delete(agentId);

  const started = new Map<string, Array<string>>();
  for (const { agentId } of subagents) {
    const anchor = anchors.get(agentId);
    if (anchor !== undefined) started.set(anchor, [...(started.get(anchor) ?? []), agentId]);
  }
  const messagesOf = new Map(subagents.map(({ agentId, messages }) => [agentId, messages]));

  const render = (
    messages: ReadonlyArray<SessionMessage>,
    parentToolUseId: string | null,
  ): ReadonlyArray<TranscriptEntry> =>
    storedEntries(messages, parentToolUseId).flatMap((entry) =>
      entry._tag === 'toolCall'
        ? [
            entry,
            ...(started.get(entry.toolUseId) ?? []).flatMap((agentId) =>
              render(messagesOf.get(agentId)!, entry.toolUseId),
            ),
          ]
        : [entry],
    );

  const unlinked = subagents.filter(({ agentId }) => !anchors.has(agentId));
  return [
    ...render(mainMessages, null),
    ...unlinked.flatMap(({ agentId, messages }): ReadonlyArray<TranscriptEntry> => [
      {
        _tag: 'status',
        parentToolUseId: null,
        text: `Earlier subagent ${agentId}: the call that started it is not in this history.`,
      },
      ...render(messages, null),
    ]),
  ];
};
