/**
 * JSON-RPC over an app-server transport: requests with IDs, notifications, and the server's own
 * requests, each answered at once with a decline or cancel so nothing waits on a human. The
 * app-server's framing has no `jsonrpc` field. Internal.
 */
import { Cause, Data, Deferred, Effect, Queue, Stream, type Scope } from 'effect';

import type { Transport } from './process.ts';
import type { Notification } from './protocol.ts';

/** The server answered a request with an error. */
export class RpcFailure extends Data.TaggedError('RpcFailure')<{
  readonly method: string;
  readonly code: number | undefined;
  readonly data: unknown;
}> {}

/** The process ended before answering. */
export class RpcClosed extends Data.TaggedError('RpcClosed') {}

export interface Rpc {
  readonly request: (
    method: string,
    params: unknown,
  ) => Effect.Effect<unknown, RpcFailure | RpcClosed>;
  readonly notify: (method: string) => Effect.Effect<void>;
  /** Every server notification in order; ends when the process ends. One consumer. */
  readonly notifications: Stream.Stream<Notification>;
}

/** Why Fluidcast declines: it runs unattended, so no human can answer. */
const unattended = 'Fluidcast runs Codex unattended: no one can answer this request.';

/**
 * The reply to a server request: the decline or cancel each request type expects, or an error
 * where its type has none. Every request is answered, so nothing waits on a human.
 */
export const declineReply = (
  method: string,
):
  | { readonly result: unknown }
  | { readonly error: { readonly code: number; readonly message: string } } => {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { result: { decision: 'decline' } };
    case 'item/tool/requestUserInput':
      return { result: { answers: {} } };
    case 'mcpServer/elicitation/request':
      return { result: { action: 'decline', content: null, ['_meta']: null } };
    case 'item/tool/call':
      return {
        result: { contentItems: [{ type: 'inputText', text: unattended }], success: false },
      };
    case 'applyPatchApproval':
    case 'execCommandApproval':
      return { result: { decision: { denied: { rejection: unattended } } } };
    default:
      // Permission grants, auth refresh, attestation and anything newer: no decline exists.
      return { error: { code: -32603, message: unattended } };
  }
};

type Incoming = Readonly<Record<string, unknown>>;

const parse = (line: string): Incoming | undefined => {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Incoming)
      : undefined;
  } catch {
    return undefined;
  }
};

/** A JSON-RPC client over `transport` for the scope: its reader runs until the transport ends. */
export const makeRpc = (transport: Transport): Effect.Effect<Rpc, never, Scope.Scope> =>
  Effect.gen(function* () {
    const pending = new Map<
      number,
      {
        readonly method: string;
        readonly reply: Deferred.Deferred<unknown, RpcFailure | RpcClosed>;
      }
    >();
    let nextId = 0;
    let closed = false;
    const notifications = yield* Queue.unbounded<Notification, Cause.Done>();
    const send = (message: unknown) => transport.write(JSON.stringify(message));

    const onMessage = (message: Incoming): Effect.Effect<void> => {
      const method = message['method'];
      const id = message['id'];
      if (typeof method === 'string') {
        if (id === undefined)
          return Queue.offer(notifications, { method, params: message['params'] }).pipe(
            Effect.asVoid,
          );
        return send({ id, ...declineReply(method) }).pipe(
          Effect.andThen(Effect.logWarning('codex server request declined')),
          Effect.annotateLogs({ method }),
        );
      }
      const waiting = typeof id === 'number' ? pending.get(id) : undefined;
      if (waiting === undefined) return Effect.void;
      pending.delete(id as number);
      const error = message['error'];
      if (typeof error === 'object' && error !== null) {
        const { code, data } = error as Readonly<Record<string, unknown>>;
        return Deferred.fail(
          waiting.reply,
          new RpcFailure({
            method: waiting.method,
            code: typeof code === 'number' ? code : undefined,
            data,
          }),
        ).pipe(Effect.asVoid);
      }
      return Deferred.succeed(waiting.reply, message['result']).pipe(Effect.asVoid);
    };

    yield* transport.lines.pipe(
      Stream.runForEach((line) => {
        const message = parse(line);
        return message === undefined ? Effect.void : onMessage(message);
      }),
      Effect.ensuring(
        Effect.gen(function* () {
          closed = true;
          for (const { reply } of pending.values()) yield* Deferred.fail(reply, new RpcClosed());
          pending.clear();
          yield* Queue.end(notifications);
        }),
      ),
      Effect.forkScoped,
    );

    const request = (method: string, params: unknown) =>
      Effect.gen(function* () {
        if (closed) return yield* new RpcClosed();
        const id = ++nextId;
        const reply = yield* Deferred.make<unknown, RpcFailure | RpcClosed>();
        pending.set(id, { method, reply });
        yield* send({ id, method, params });
        return yield* Deferred.await(reply);
      });

    return {
      request,
      notify: (method) => send({ method }),
      notifications: Stream.fromQueue(notifications),
    };
  });

/** The `codexErrorInfo` an error response carries in its `data`, if any. */
const errorInfoOf = (data: unknown): unknown => {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Readonly<Record<string, unknown>>;
  if ('codexErrorInfo' in record) return record['codexErrorInfo'];
  const error = record['error'];
  return typeof error === 'object' && error !== null
    ? (error as Readonly<Record<string, unknown>>)['codexErrorInfo']
    : undefined;
};

/** A `turn/start` refused because the running turn (a review or compaction) cannot be steered. */
export const isNotSteerable = (error: RpcFailure | RpcClosed): boolean => {
  if (error._tag !== 'RpcFailure') return false;
  const info = errorInfoOf(error.data);
  return typeof info === 'object' && info !== null && 'activeTurnNotSteerable' in info;
};

/** Opens the conversation: `initialize`, then `initialized`. */
export const initialize = (rpc: Rpc) =>
  rpc
    .request('initialize', {
      clientInfo: { name: 'fluidcast', title: 'Fluidcast', version: '0.0.0' },
      capabilities: null,
    })
    .pipe(Effect.andThen(rpc.notify('initialized')));
