import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect } from 'effect';

import { WorkerSetupError } from '../worker.ts';
import { attachWith, readThreadWith } from './attach.ts';
import {
  agentMessage,
  fakeServer,
  main,
  reasoning,
  spawn,
  subagentStarted,
  userMessage,
} from './frames.test.ts';

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

/** A stored-thread server: each thread's turns (as item lists), paged one turn at a time. */
const storedServer = (
  turns: Readonly<Record<string, ReadonlyArray<ReadonlyArray<unknown>>>>,
  extra: (
    method: string,
    params: Readonly<Record<string, unknown>>,
  ) => { result: unknown } | { error: unknown } | undefined = () => undefined,
) =>
  fakeServer(({ method, params }) => {
    const request = params as Readonly<Record<string, unknown>>;
    const answer = extra(method, request);
    if (answer !== undefined) return answer;
    switch (method) {
      case 'initialize':
        return { result: {} };
      case 'thread/read':
        return {
          result: {
            thread: {
              id: request['threadId'],
              cwd: '/recorded',
              model: 'invented-model',
              reasoningEffort: 'high',
            },
          },
        };
      case 'thread/turns/list': {
        const all = turns[request['threadId'] as string];
        if (all === undefined) return { error: { code: -32600, message: 'thread not loaded' } };
        const at = request['cursor'] === undefined ? 0 : Number(request['cursor']);
        return {
          result: {
            data: all
              .slice(at, at + 1)
              .map((items) => ({ id: `turn-${at}`, items, status: 'completed' })),
            nextCursor: at + 1 < all.length ? String(at + 1) : null,
          },
        };
      }
      default:
        return undefined;
    }
  });

describe('attachWith', () => {
  it('reads the recorded directory and every page of history, with subagents nested', () =>
    run(
      Effect.gen(function* () {
        const server = yield* storedServer({
          [main]: [
            [userMessage(null, 'Start.'), spawn('call-a', ['thread-a'])],
            [agentMessage('Done.'), subagentStarted('call-b', 'thread-b')],
          ],
          'thread-a': [[userMessage(null, 'Explore.'), agentMessage('Found.', 'item-a')]],
          'thread-b': [[agentMessage('pong', 'item-b')]],
        });
        const attached = yield* attachWith(server.open)(main);
        assert.equal(attached.cwd, '/recorded');
        assert.deepEqual(
          attached.history.map((entry) => [entry._tag, entry.parentToolUseId]),
          [
            ['prompt', null],
            ['toolCall', null],
            ['prompt', 'call-a'],
            ['text', 'call-a'],
            ['toolResult', null],
            ['text', null],
            ['toolCall', null],
            ['text', 'call-b'],
            ['toolResult', null],
          ],
        );
        assert.deepEqual(server.requests('thread/turns/list')[0]?.['params'], {
          threadId: main,
          itemsView: 'full',
          sortDirection: 'asc',
        });
        assert.equal(server.state.released, 1);
      }),
    ));

  it('reads a thread with no turns as empty history', () =>
    run(
      Effect.gen(function* () {
        const server = yield* storedServer({}, (method) =>
          method === 'thread/turns/list'
            ? { error: { code: -32601, message: 'list_turns is not supported yet' } }
            : undefined,
        );
        assert.deepEqual(yield* attachWith(server.open)(main), { cwd: '/recorded', history: [] });
      }),
    ));

  it('fails with SessionUnreadable on any other failure', () =>
    run(
      Effect.gen(function* () {
        const unknown = yield* storedServer({}, (method) =>
          method === 'thread/read'
            ? { error: { code: -32600, message: 'thread not loaded: x' } }
            : undefined,
        );
        assert.deepEqual(
          yield* Effect.flip(attachWith(unknown.open)('x')),
          new WorkerSetupError({ sessionId: 'x', reason: 'SessionUnreadable' }),
        );
        assert.equal(unknown.state.released, 1);
        const malformed = yield* storedServer({}, (method) =>
          method === 'thread/read' ? { result: { thread: {} } } : undefined,
        );
        assert.deepEqual(
          yield* Effect.flip(attachWith(malformed.open)(main)),
          new WorkerSetupError({ sessionId: main, reason: 'SessionUnreadable' }),
        );
      }),
    ));
});

describe('reasoning in stored history', () => {
  it('is skipped, leaving preload history and the last answer readable', () =>
    run(
      Effect.gen(function* () {
        const server = yield* storedServer({
          [main]: [[userMessage(null, 'Why?'), reasoning(), agentMessage('Because.')]],
        });
        const attached = yield* attachWith(server.open)(main);
        assert.deepEqual(
          attached.history.map((entry) => entry._tag),
          ['prompt', 'text'],
        );
        const stored = yield* readThreadWith(server.open)(main);
        assert.equal(stored.lastAnswer, 'Because.');
      }),
    ));
});

describe('readThreadWith', () => {
  it("reads the recorded model and effort and the main thread's last answer", () =>
    run(
      Effect.gen(function* () {
        const server = yield* storedServer({
          [main]: [
            [userMessage(null, 'First.'), agentMessage('Old.')],
            [
              userMessage(null, 'Second.'),
              agentMessage('One.'),
              spawn('call-a', ['thread-a']),
              agentMessage('Two.', 'item-2'),
            ],
          ],
          'thread-a': [[agentMessage('Child.')]],
        });
        assert.deepEqual(yield* readThreadWith(server.open)(main), {
          model: 'invented-model',
          effort: 'high',
          lastAnswer: 'One.\n\nTwo.',
        });
      }),
    ));

  it('fails with SessionUnreadable when the thread cannot be read', () =>
    run(
      Effect.gen(function* () {
        const server = yield* storedServer({}, (method) =>
          method === 'thread/read'
            ? { error: { code: -32600, message: 'invalid thread id' } }
            : undefined,
        );
        assert.deepEqual(
          yield* Effect.flip(readThreadWith(server.open)('bad')),
          new WorkerSetupError({ sessionId: 'bad', reason: 'SessionUnreadable' }),
        );
      }),
    ));
});
