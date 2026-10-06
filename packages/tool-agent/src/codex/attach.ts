/**
 * Reading a stored Codex thread through a short-lived app-server, with the transport as a parameter
 * so it can be driven by synthetic replies. It starts no turn and no model call. Internal: the
 * `./codex` entry builds `attach` and `readCodexThread` from it.
 */
import { Effect, Schema } from 'effect';

import type { TranscriptEntry } from '../schema.ts';
import { WorkerSetupError } from '../worker.ts';
import type { OpenTransport } from './process.ts';
import { itemOf, ThreadReadResponse, TurnsPage, type Item } from './protocol.ts';
import { initialize, makeRpc, type Rpc } from './rpc.ts';
import { historyEntries, lastAnswer, spawnedThreads } from './transcript.ts';

/** `thread/turns/list` on a thread that has no turns yet. */
const noTurnsCode = -32601;

/** Every item of a thread, oldest first, across all pages of its turns. No turns: none. */
const threadItems = (rpc: Rpc, threadId: string) =>
  Effect.gen(function* () {
    const items: Array<Item> = [];
    let cursor: string | undefined;
    do {
      const page = yield* rpc
        .request('thread/turns/list', {
          threadId,
          itemsView: 'full',
          sortDirection: 'asc',
          ...(cursor === undefined ? {} : { cursor }),
        })
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(TurnsPage)));
      for (const turn of page.data) items.push(...turn.items.flatMap((item) => itemOf(item) ?? []));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return items;
  }).pipe(
    Effect.catchIf(
      (error) => error._tag === 'RpcFailure' && error.code === noTurnsCode,
      () => Effect.succeed<ReadonlyArray<Item>>([]),
    ),
  );

/** A stored thread as one read: its record and its items, in a fresh app-server. */
const readThread = <A, E>(
  open: OpenTransport,
  threadId: string,
  read: (rpc: Rpc) => Effect.Effect<A, E>,
): Effect.Effect<A, WorkerSetupError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const rpc = yield* makeRpc(yield* open);
      yield* initialize(rpc);
      return yield* read(rpc);
    }),
  ).pipe(
    // Codex has no stable not-found code, so every failure is the same: unreadable.
    Effect.mapError(
      () => new WorkerSetupError({ sessionId: threadId, reason: 'SessionUnreadable' }),
    ),
  );

const threadRecord = (rpc: Rpc, threadId: string) =>
  rpc.request('thread/read', { threadId }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ThreadReadResponse)),
    Effect.map(({ thread }) => thread),
  );

/**
 * A stored thread's recorded directory and its history: the main thread, with each subagent thread
 * its items start read too (recursively) and nested under the item that started it.
 */
export const attachWith =
  (open: OpenTransport) =>
  (
    sessionId: string,
  ): Effect.Effect<
    { readonly cwd: string; readonly history: ReadonlyArray<TranscriptEntry> },
    WorkerSetupError
  > =>
    readThread(open, sessionId, (rpc) =>
      Effect.gen(function* () {
        const { cwd } = yield* threadRecord(rpc, sessionId);
        const threads = new Map<string, ReadonlyArray<Item>>();
        const toRead = [sessionId];
        while (toRead.length > 0) {
          const threadId = toRead.shift()!;
          if (threads.has(threadId)) continue;
          const items = yield* threadItems(rpc, threadId);
          threads.set(threadId, items);
          toRead.push(...items.flatMap(spawnedThreads));
        }
        return { cwd, history: historyEntries(sessionId, threads) };
      }),
    );

/** What Continue needs of a stored Codex thread. */
export interface CodexThread {
  /** The thread's recorded model, when Codex reports one. */
  readonly model: string | undefined;
  /** The thread's recorded reasoning effort, when Codex reports one. */
  readonly effort: string | undefined;
  /** Every agent message after the last user message, joined by blank lines; none: `undefined`. */
  readonly lastAnswer: string | undefined;
}

/** Reads a stored thread's model, effort and last answer. Any failure: `SessionUnreadable`. */
export const readThreadWith =
  (open: OpenTransport) =>
  (threadId: string): Effect.Effect<CodexThread, WorkerSetupError> =>
    readThread(open, threadId, (rpc) =>
      Effect.gen(function* () {
        const thread = yield* threadRecord(rpc, threadId);
        const items = yield* threadItems(rpc, threadId);
        return {
          model: thread.model ?? undefined,
          effort: thread.reasoningEffort ?? undefined,
          lastAnswer: lastAnswer(items),
        };
      }),
    );
