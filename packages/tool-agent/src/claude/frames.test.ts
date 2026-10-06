/** Synthetic Claude Code frames and stored messages for the adapter tests. Invented content only. */
import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';

/** Frames carry many fields the adapter never reads; tests build only the ones it does. */
const frame = (value: Readonly<Record<string, unknown>>) => value as unknown as SDKMessage;

export const assistant = (
  content: ReadonlyArray<Readonly<Record<string, unknown>>>,
  extra: {
    readonly parent?: string;
    readonly consumed?: ReadonlyArray<string>;
    readonly error?: string;
  } = {},
) =>
  frame({
    type: 'assistant',
    message: { content },
    parent_tool_use_id: extra.parent ?? null,
    ...(extra.consumed === undefined ? {} : { user_message_uuids: extra.consumed }),
    ...(extra.error === undefined ? {} : { error: extra.error }),
  });

export const say = (text: string, consumed?: ReadonlyArray<string>) =>
  assistant([{ type: 'text', text }], consumed === undefined ? {} : { consumed });

export const toolResults = (
  content: ReadonlyArray<Readonly<Record<string, unknown>>>,
  extra: { readonly parent?: string; readonly replay?: boolean } = {},
) =>
  frame({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: extra.parent ?? null,
    ...(extra.replay === true ? { isReplay: true } : {}),
  });

export const result = (
  extra: {
    readonly subtype?: string;
    readonly isError?: boolean;
    readonly consumed?: ReadonlyArray<string>;
    readonly consumedOne?: string;
    readonly startupFailure?: string;
  } = {},
) =>
  frame({
    type: 'result',
    subtype: extra.subtype ?? 'success',
    is_error: extra.isError ?? (extra.subtype !== undefined && extra.subtype !== 'success'),
    ...(extra.consumed === undefined ? {} : { user_message_uuids: extra.consumed }),
    ...(extra.consumedOne === undefined ? {} : { user_message_uuid: extra.consumedOne }),
    ...(extra.startupFailure === undefined ? {} : { startup_failure_reason: extra.startupFailure }),
  });

export const state = (value: 'idle' | 'running' | 'requires_action') =>
  frame({ type: 'system', subtype: 'session_state_changed', state: value });

export const background = (
  ...tasks: ReadonlyArray<string | { readonly id: string; readonly ambient: true }>
) =>
  frame({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: tasks.map((task) =>
      typeof task === 'string'
        ? { task_id: task, task_type: 'local_agent', description: 'Task' }
        : { task_id: task.id, task_type: 'local_agent', description: 'Task', ambient: true },
    ),
  });

export const rateLimit = (status: 'allowed' | 'rejected', resetsAt?: number) =>
  frame({
    type: 'rate_limit_event',
    rate_limit_info: { status, ...(resetsAt === undefined ? {} : { resetsAt }) },
  });

export const progress = (summary: string | undefined, toolUseId?: string) =>
  frame({
    type: 'system',
    subtype: 'task_progress',
    task_id: 'task_1',
    description: 'Task',
    ...(toolUseId === undefined ? {} : { tool_use_id: toolUseId }),
    ...(summary === undefined ? {} : { summary }),
  });

/** A stored message. */
export const stored = (
  type: 'user' | 'assistant',
  content: string | ReadonlyArray<Readonly<Record<string, unknown>>>,
  parent: string | null = null,
): SessionMessage => ({
  type,
  uuid: 'u',
  session_id: 's',
  message: { role: type, content },
  parent_tool_use_id: parent,
  parent_agent_id: null,
});

export const toolUse = (id: string, name: string, input: unknown = {}) => ({
  type: 'tool_use',
  id,
  name,
  input,
});

export const toolResult = (id: string, content: unknown, isError = false) => ({
  type: 'tool_result',
  tool_use_id: id,
  content,
  ...(isError ? { is_error: true } : {}),
});

export const text = (value: string) => ({ type: 'text', text: value });
