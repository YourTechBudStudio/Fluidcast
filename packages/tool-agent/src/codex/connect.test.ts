import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect, Exit, Fiber, Queue, Ref, Stream } from 'effect';

import { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import type { WorkerEvent, WorkerMessage } from '../worker.ts';
import { connectWith, threadRequest } from './connect.ts';
import {
  agentMessage,
  fakeServer,
  itemCompleted,
  main,
  status,
  turnCompleted,
  turnStarted,
} from './frames.test.ts';
import { SpawnFailed } from './process.ts';

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const flush = Effect.gen(function* () {
  for (let round = 0; round < 50; round++) yield* Effect.yieldNow;
});

const consume = (stream: Stream.Stream<WorkerEvent, ToolFault>) =>
  Effect.gen(function* () {
    const events = yield* Ref.make<ReadonlyArray<WorkerEvent>>([]);
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(stream, (event) => Ref.update(events, (all) => [...all, event])),
    );
    const tags = Effect.map(Ref.get(events), (all) =>
      all.map((event) => (event._tag === 'Entry' ? `Entry:${event.entry._tag}` : event._tag)),
    );
    return { fiber, events: Ref.get(events), tags };
  });

const newWorker = { cwd: '/work', resume: undefined };

/** A server that opens threads as `main` and accepts every message. */
const accepting = (
  extra: (
    method: string,
    params: unknown,
  ) => { result: unknown } | { error: unknown } | undefined = () => undefined,
) =>
  fakeServer(({ method, params }) => {
    const answer = extra(method, params);
    if (answer !== undefined) return answer;
    switch (method) {
      case 'initialize':
        return { result: {} };
      case 'thread/start':
      case 'thread/resume':
        return { result: { thread: { id: main } } };
      case 'turn/start':
        return { result: { turn: { id: 'turn' } } };
      default:
        return undefined;
    }
  });

const message = (id: string): WorkerMessage => ({ id, text: `Message ${id}.` });

describe('threadRequest', () => {
  it('starts a new thread with no session ID, and resumes without a model', () => {
    assert.deepEqual(threadRequest({ model: 'invented-model', effort: 'high' }, newWorker), [
      'thread/start',
      {
        cwd: '/work',
        model: 'invented-model',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
    ]);
    assert.deepEqual(threadRequest({}, newWorker), [
      'thread/start',
      { cwd: '/work', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' },
    ]);
    assert.deepEqual(
      threadRequest({ model: 'invented-model' }, { cwd: '/recorded', resume: 'thread-old' }),
      [
        'thread/resume',
        {
          threadId: 'thread-old',
          cwd: '/recorded',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'auto_review',
        },
      ],
    );
  });
});

describe('connectWith', () => {
  it('initializes, reports the new thread, sends messages as turn/start and maps frames', () =>
    run(
      Effect.gen(function* () {
        const server = yield* accepting();
        const inbox = yield* Queue.unbounded<WorkerMessage>();
        const worker = yield* consume(
          connectWith(server.open, { effort: 'low' })(newWorker, Stream.fromQueue(inbox)),
        );
        yield* flush;
        yield* Queue.offer(inbox, message('m1'));
        yield* flush;
        for (const notification of [
          turnStarted(),
          itemCompleted({ type: 'userMessage', id: 'u', clientId: 'm1', content: [] }),
          itemCompleted(agentMessage('Hello.')),
          status('idle'),
          turnCompleted(),
        ]) {
          yield* server.notify(notification);
        }
        yield* flush;
        assert.deepEqual(
          server.written.map((written) => written['method']),
          ['initialize', 'initialized', 'thread/start', 'turn/start'],
        );
        assert.deepEqual(server.requests('turn/start')[0]?.['params'], {
          threadId: main,
          input: [{ type: 'text', text: 'Message m1.', text_elements: [] }],
          clientUserMessageId: 'm1',
          effort: 'low',
        });
        assert.deepEqual(yield* worker.tags, [
          'SessionStarted',
          'Consumed',
          'Entry:text',
          'Entry:turnEnd',
          'Settled',
        ]);
        assert.deepEqual((yield* worker.events)[0], { _tag: 'SessionStarted', sessionId: main });
        yield* Fiber.interrupt(worker.fiber);
        assert.equal(server.state.released, 1);
      }),
    ));

  it('reports no SessionStarted on resume', () =>
    run(
      Effect.gen(function* () {
        const server = yield* accepting();
        const worker = yield* consume(
          connectWith(server.open, {})({ cwd: '/recorded', resume: main }, Stream.never),
        );
        yield* flush;
        yield* server.notify(turnCompleted());
        yield* flush;
        assert.deepEqual(yield* worker.tags, ['Entry:turnEnd', 'Settled']);
        assert.equal(server.requests('thread/resume').length, 1);
        yield* Fiber.interrupt(worker.fiber);
      }),
    ));

  it('holds a message the running turn cannot take, and later ones behind it, until the turn completes', () =>
    run(
      Effect.gen(function* () {
        let attempts = 0;
        const server = yield* accepting((method) => {
          if (method !== 'turn/start') return undefined;
          attempts++;
          return attempts === 1
            ? {
                error: {
                  code: -32600,
                  message: 'busy',
                  data: { codexErrorInfo: { activeTurnNotSteerable: { turnKind: 'review' } } },
                },
              }
            : undefined;
        });
        const inbox = yield* Queue.unbounded<WorkerMessage>();
        const worker = yield* consume(
          connectWith(server.open, {})(newWorker, Stream.fromQueue(inbox)),
        );
        yield* flush;
        yield* Queue.offer(inbox, message('m1'));
        yield* Queue.offer(inbox, message('m2'));
        yield* flush;
        assert.deepEqual(
          server
            .requests('turn/start')
            .map(
              (written) =>
                (written['params'] as { clientUserMessageId: string }).clientUserMessageId,
            ),
          ['m1'],
        );
        yield* server.notify(turnCompleted());
        yield* flush;
        assert.deepEqual(
          server
            .requests('turn/start')
            .map(
              (written) =>
                (written['params'] as { clientUserMessageId: string }).clientUserMessageId,
            ),
          ['m1', 'm1', 'm2'],
        );
        yield* Fiber.interrupt(worker.fiber);
      }),
    ));

  it('faults with CodexMessageRejected when a message is refused, or refused again', () =>
    run(
      Effect.gen(function* () {
        const refused = yield* accepting((method) =>
          method === 'turn/start'
            ? { error: { code: -32600, message: 'no', data: null } }
            : undefined,
        );
        const inbox = yield* Queue.unbounded<WorkerMessage>();
        const worker = yield* consume(
          connectWith(refused.open, {})(newWorker, Stream.fromQueue(inbox)),
        );
        yield* Queue.offer(inbox, message('m1'));
        assert.deepEqual(
          yield* Fiber.await(worker.fiber),
          Exit.fail(new ToolFault({ reason: 'CodexMessageRejected' })),
        );
        assert.equal(refused.state.released, 1);

        const notSteerable = {
          error: {
            code: -32600,
            message: 'busy',
            data: { codexErrorInfo: { activeTurnNotSteerable: { turnKind: 'compact' } } },
          },
        };
        const twice = yield* accepting((method) =>
          method === 'turn/start' ? notSteerable : undefined,
        );
        const again = yield* Queue.unbounded<WorkerMessage>();
        const second = yield* consume(
          connectWith(twice.open, {})(newWorker, Stream.fromQueue(again)),
        );
        yield* Queue.offer(again, message('m1'));
        yield* flush;
        yield* twice.notify(turnCompleted());
        assert.deepEqual(
          yield* Fiber.await(second.fiber),
          Exit.fail(new ToolFault({ reason: 'CodexMessageRejected' })),
        );
        assert.equal(twice.requests('turn/start').length, 2);
      }),
    ));

  it('fails with CodexExited after every earlier frame when the process ends', () =>
    run(
      Effect.gen(function* () {
        const server = yield* accepting();
        const worker = yield* consume(connectWith(server.open, {})(newWorker, Stream.never));
        yield* flush;
        yield* server.notify(itemCompleted(agentMessage('Last words.')));
        yield* server.end;
        assert.deepEqual(
          yield* Fiber.await(worker.fiber),
          Exit.fail(new ToolFault({ reason: 'CodexExited' })),
        );
        assert.deepEqual(yield* worker.tags, ['SessionStarted', 'Entry:text']);
        assert.equal(server.state.released, 1);
      }),
    ));

  it('keeps every earlier frame when the process ends while a message awaits its reply', () =>
    run(
      Effect.gen(function* () {
        // `turn/start` is never answered: the send is still pending when stdout ends.
        const server = yield* fakeServer(({ method }) =>
          method === 'initialize'
            ? { result: {} }
            : method === 'thread/start'
              ? { result: { thread: { id: main } } }
              : undefined,
        );
        const inbox = yield* Queue.unbounded<WorkerMessage>();
        const worker = yield* consume(
          connectWith(server.open, {})(newWorker, Stream.fromQueue(inbox)),
        );
        yield* flush;
        yield* Queue.offer(inbox, message('m1'));
        yield* flush;
        assert.equal(server.requests('turn/start').length, 1);
        yield* server.notify(itemCompleted(agentMessage('Last words.')));
        yield* server.end;
        assert.deepEqual(
          yield* Fiber.await(worker.fiber),
          Exit.fail(new ToolFault({ reason: 'CodexExited' })),
        );
        assert.deepEqual(yield* worker.tags, ['SessionStarted', 'Entry:text']);
        assert.equal(server.state.released, 1);
      }),
    ));

  it('fails with CodexStartup when the process cannot start or the thread cannot open', () =>
    run(
      Effect.gen(function* () {
        const cannotSpawn = yield* consume(
          connectWith(Effect.fail(new SpawnFailed()), {})(newWorker, Stream.never),
        );
        assert.deepEqual(
          yield* Fiber.await(cannotSpawn.fiber),
          Exit.fail(new ToolFault({ reason: 'CodexStartup' })),
        );

        const server = yield* accepting((method) =>
          method === 'thread/resume'
            ? { error: { code: -32600, message: 'no rollout found' } }
            : undefined,
        );
        const worker = yield* consume(
          connectWith(server.open, {})({ cwd: '/work', resume: 'missing' }, Stream.never),
        );
        assert.deepEqual(
          yield* Fiber.await(worker.fiber),
          Exit.fail(new ToolFault({ reason: 'CodexStartup' })),
        );
        assert.equal(server.state.released, 1);
      }),
    ));

  it('records nothing on interruption and releases the process', () =>
    run(
      Effect.gen(function* () {
        const server = yield* accepting();
        const worker = yield* consume(connectWith(server.open, {})(newWorker, Stream.never));
        yield* flush;
        const exit = yield* Fiber.interrupt(worker.fiber).pipe(
          Effect.andThen(Fiber.await(worker.fiber)),
        );
        assert.ok(Exit.hasInterrupts(exit));
        assert.deepEqual(yield* worker.tags, ['SessionStarted']);
        assert.equal(server.state.released, 1);
      }),
    ));
});
