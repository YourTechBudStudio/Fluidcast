/** Synthetic app-server notifications and a fake app-server for the Codex adapter tests. Invented content only. */
import { Cause, Effect, Queue, Stream } from 'effect';

import type { OpenTransport, Transport } from './process.ts';
import type { Notification } from './protocol.ts';

export const main = 'thread-main';

const note = (method: string, params: unknown): Notification => ({ method, params });

export const turnStarted = (threadId = main) =>
  note('turn/started', { threadId, turn: { id: 'turn', status: 'inProgress', error: null } });

export const turnCompleted = (
  threadId = main,
  status = 'completed',
  codexErrorInfo: unknown = null,
) =>
  note('turn/completed', {
    threadId,
    turn: {
      id: 'turn',
      status,
      error: status === 'failed' ? { message: 'Invented failure.', codexErrorInfo } : null,
    },
  });

export const status = (type: string, threadId = main) =>
  note('thread/status/changed', { threadId, status: { type } });

export const itemStarted = (item: Readonly<Record<string, unknown>>, threadId = main) =>
  note('item/started', { threadId, turnId: 'turn', item });

export const itemCompleted = (item: Readonly<Record<string, unknown>>, threadId = main) =>
  note('item/completed', { threadId, turnId: 'turn', item });

export const userMessage = (clientId: string | null, text = 'Go.', id = 'item-user') => ({
  type: 'userMessage',
  id,
  clientId,
  content: [{ type: 'text', text, text_elements: [] }],
});

export const agentMessage = (text: string, id = 'item-agent') => ({
  type: 'agentMessage',
  id,
  text,
  phase: null,
});

/** A reasoning item as Codex records it: summary and content are lists of strings. */
export const reasoning = (id = 'item-reasoning') => ({
  type: 'reasoning',
  id,
  summary: ['Invented summary.'],
  content: ['Invented reasoning.'],
});

export const command = (
  id: string,
  extra: {
    readonly status?: string;
    readonly exitCode?: number | null;
    readonly output?: string;
  } = {},
) => ({
  type: 'commandExecution',
  id,
  command: 'ls',
  cwd: '/work',
  status: extra.status ?? 'completed',
  aggregatedOutput: extra.output ?? 'a.txt',
  exitCode: extra.exitCode === undefined ? 0 : extra.exitCode,
});

export const spawn = (id: string, children: ReadonlyArray<string>, statusValue = 'completed') => ({
  type: 'collabAgentToolCall',
  id,
  tool: 'spawnAgent',
  status: statusValue,
  senderThreadId: main,
  receiverThreadIds: children,
  prompt: 'Explore.',
  model: 'invented-model',
  reasoningEffort: 'medium',
  agentsStates: {},
});

/** A subagent start, as Codex 0.160.1 reports it with current models. */
export const subagentStarted = (id: string, child: string) => ({
  type: 'subAgentActivity',
  id,
  kind: 'started',
  agentThreadId: child,
  agentPath: '/root/explorer',
});

export const rateLimits = (primary: number, secondary: number) =>
  note('account/rateLimits/updated', {
    rateLimits: {
      limitId: 'codex',
      primary: { usedPercent: primary, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: secondary, windowDurationMins: 10080, resetsAt: 1_900_000_000 },
    },
  });

type Message = Readonly<Record<string, unknown>>;

/**
 * A fake app-server: `reply` answers each client request (a `result`, an `error`, or nothing to
 * leave it pending). Tests push server lines with `push` and end stdout with `end`.
 */
export const fakeServer = (
  reply: (request: {
    readonly method: string;
    readonly params: unknown;
  }) => { readonly result: unknown } | { readonly error: unknown } | undefined,
) =>
  Effect.gen(function* () {
    const lines = yield* Queue.unbounded<string, Cause.Done>();
    const written: Array<Message> = [];
    const state = { opened: 0, released: 0 };
    const push = (message: unknown) => Queue.offer(lines, JSON.stringify(message));
    const transport: Transport = {
      lines: Stream.fromQueue(lines),
      write: (line) =>
        Effect.gen(function* () {
          const message = JSON.parse(line) as Message;
          written.push(message);
          const method = message['method'];
          if (typeof method !== 'string' || message['id'] === undefined) return;
          const answer = reply({ method, params: message['params'] });
          if (answer !== undefined) yield* push({ id: message['id'], ...answer });
        }),
    };
    const open: OpenTransport = Effect.acquireRelease(
      Effect.sync(() => {
        state.opened++;
        return transport;
      }),
      () =>
        Effect.sync(() => {
          state.released++;
        }),
    );
    return {
      open,
      written,
      state,
      push,
      notify: (notification: Notification) => push(notification),
      end: Queue.end(lines),
      /** Requests the client sent, by method. */
      requests: (method: string) => written.filter((message) => message['method'] === method),
    };
  });
