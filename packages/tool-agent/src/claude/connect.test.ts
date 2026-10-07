import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Effect, Exit, Fiber, Queue, Ref, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import type { WorkerEvent, WorkerMessage } from '../worker.ts';
import { connectWith, queryOptions, runTracker, type QueryFunction } from './connect.ts';
import { background, result, say, state } from './frames.test.ts';
import { initialTurnState } from './turn.ts';

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())) as Effect.Effect<A, E>);

/** Lets forked fibers process what was pushed; the test clock does not move. */
const flush = Effect.gen(function* () {
  for (let round = 0; round < 50; round++) yield* Effect.yieldNow;
});

/** Consumes a worker stream in the background, collecting its events. */
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

describe('runTracker', () => {
  it('settles on the grace timer, one second after the background set empties', () =>
    run(
      Effect.gen(function* () {
        const frames = yield* Queue.unbounded<SDKMessage, ToolFault>();
        const worker = yield* consume(
          runTracker(Stream.fromQueue(frames), initialTurnState(false)),
        );
        for (const frame of [
          state('running'),
          background('task_1'),
          result(),
          state('idle'),
          background(),
        ]) {
          yield* Queue.offer(frames, frame);
        }
        yield* flush;
        yield* TestClock.adjust('999 millis');
        yield* flush;
        assert.deepEqual(yield* worker.tags, ['Entry:turnEnd']);
        yield* TestClock.adjust('1 millis');
        yield* flush;
        assert.deepEqual(yield* worker.tags, ['Entry:turnEnd', 'Settled']);
        yield* Fiber.interrupt(worker.fiber);
      }),
    ));

  it('cancels the grace timer when an automatic turn starts, and settles after its result', () =>
    run(
      Effect.gen(function* () {
        const frames = yield* Queue.unbounded<SDKMessage, ToolFault>();
        const worker = yield* consume(
          runTracker(Stream.fromQueue(frames), initialTurnState(false)),
        );
        for (const frame of [
          state('running'),
          background('task_1'),
          result(),
          state('idle'),
          background(),
          state('running'),
        ]) {
          yield* Queue.offer(frames, frame);
        }
        yield* flush;
        yield* TestClock.adjust('5 seconds');
        yield* flush;
        assert.deepEqual(yield* worker.tags, ['Entry:turnEnd']);
        yield* Queue.offer(frames, say('Background work done.'));
        yield* Queue.offer(frames, result());
        yield* Queue.offer(frames, state('idle'));
        yield* flush;
        assert.deepEqual(yield* worker.tags, [
          'Entry:turnEnd',
          'Entry:text',
          'Entry:turnEnd',
          'Settled',
        ]);
        yield* Fiber.interrupt(worker.fiber);
      }),
    ));

  it('fails with ClaudeStartup after a startup failure turn end, without settling', () =>
    run(
      Effect.gen(function* () {
        const frames = yield* Queue.unbounded<SDKMessage, ToolFault>();
        const worker = yield* consume(
          runTracker(Stream.fromQueue(frames), initialTurnState(false)),
        );
        yield* Queue.offer(
          frames,
          result({ subtype: 'error_during_execution', startupFailure: 'cwd_unavailable' }),
        );
        yield* Queue.offer(frames, state('idle'));
        assert.deepEqual(
          yield* Fiber.await(worker.fiber),
          Exit.fail(new ToolFault({ reason: 'ClaudeStartup' })),
        );
        assert.deepEqual(yield* worker.tags, ['Entry:turnEnd']);
      }),
    ));

  it('processes every earlier frame before failing with the end of the frames', () =>
    run(
      Effect.gen(function* () {
        const frames = yield* Queue.unbounded<SDKMessage, ToolFault>();
        const worker = yield* consume(
          runTracker(Stream.fromQueue(frames), initialTurnState(false)),
        );
        yield* Queue.offer(frames, say('Last words.'));
        yield* Queue.fail(frames, new ToolFault({ reason: 'ClaudeExited' }));
        assert.deepEqual(
          yield* Fiber.await(worker.fiber),
          Exit.fail(new ToolFault({ reason: 'ClaudeExited' })),
        );
        assert.deepEqual(yield* worker.tags, ['Entry:text']);
      }),
    ));
});

/** A fake SDK `query`: yields `frames`, then ends, or waits forever when `hold` is set. */
const fakeQuery = (frames: ReadonlyArray<SDKMessage>, hold = false) => {
  const calls = {
    options: [] as Array<Options>,
    prompts: [] as Array<AsyncIterable<SDKUserMessage>>,
    closed: 0,
  };
  const query: QueryFunction = ({ prompt, options }) => {
    calls.options.push(options);
    calls.prompts.push(prompt);
    async function* iterate() {
      yield* frames;
      if (hold) await new Promise(() => {});
    }
    return Object.assign(iterate(), {
      close: () => {
        calls.closed++;
      },
    });
  };
  return { query, calls };
};

const environment = { PATH: '/bin', HOME: '/home/someone' };
const executable = '/usr/local/bin/claude';
const sessionId = 'b0a1c2d3-0000-4000-8000-000000000001';
const worker = { cwd: '/work', resume: undefined };

describe('connectWith', () => {
  it('passes exactly the agreed query options', () => {
    assert.deepEqual(queryOptions({ executable, environment }, worker), {
      cwd: '/work',
      pathToClaudeCodeExecutable: executable,
      permissionMode: 'auto',
      settingSources: ['user', 'project', 'local'],
      disallowedTools: ['AskUserQuestion'],
      forwardSubagentText: true,
      agentProgressSummaries: true,
      env: {
        PATH: '/bin',
        HOME: '/home/someone',
        CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
        CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1',
      },
    });
    assert.deepEqual(
      queryOptions(
        { executable, environment, model: 'opus', effort: 'high', permissionMode: 'acceptEdits' },
        { ...worker, resume: sessionId },
      ),
      {
        cwd: '/work',
        pathToClaudeCodeExecutable: executable,
        resume: sessionId,
        model: 'opus',
        effort: 'high',
        permissionMode: 'acceptEdits',
        settingSources: ['user', 'project', 'local'],
        disallowedTools: ['AskUserQuestion'],
        forwardSubagentText: true,
        agentProgressSummaries: true,
        env: {
          PATH: '/bin',
          HOME: '/home/someone',
          CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
          CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1',
        },
      },
    );
  });

  it('sends input as ordinary user messages with their ids', () =>
    run(
      Effect.gen(function* () {
        const fake = fakeQuery([], true);
        const inbox = yield* Queue.unbounded<WorkerMessage>();
        const consumer = yield* consume(
          connectWith(fake.query, { executable, environment })(worker, Stream.fromQueue(inbox)),
        );
        yield* Queue.offer(inbox, {
          id: 'b0a1c2d3-0000-4000-8000-00000000000a',
          text: '/plan Go.',
        });
        yield* flush;
        const iterator = fake.calls.prompts[0]![Symbol.asyncIterator]();
        const first = yield* Effect.promise(() => iterator.next());
        assert.deepEqual(first.value, {
          type: 'user',
          message: { role: 'user', content: '/plan Go.' },
          parent_tool_use_id: null,
          uuid: 'b0a1c2d3-0000-4000-8000-00000000000a',
        });
        yield* Fiber.interrupt(consumer.fiber);
      }),
    ));

  it('fails with ClaudeExited when the frames end, after their events, and closes the query', () =>
    run(
      Effect.gen(function* () {
        const fake = fakeQuery([say('Bye.', ['m1'])]);
        const consumer = yield* consume(
          connectWith(fake.query, { executable, environment })(worker, Stream.empty),
        );
        assert.deepEqual(
          yield* Fiber.await(consumer.fiber),
          Exit.fail(new ToolFault({ reason: 'ClaudeExited' })),
        );
        assert.deepEqual(yield* consumer.tags, ['Entry:text', 'Consumed']);
        assert.equal(fake.calls.closed, 1);
      }),
    ));

  it('records nothing on interruption and closes the query', () =>
    run(
      Effect.gen(function* () {
        const fake = fakeQuery([say('Working.')], true);
        const consumer = yield* consume(
          connectWith(fake.query, { executable, environment })(worker, Stream.never),
        );
        yield* flush;
        const exit = yield* Fiber.interrupt(consumer.fiber).pipe(
          Effect.andThen(Fiber.await(consumer.fiber)),
        );
        assert.ok(Exit.hasInterrupts(exit));
        assert.equal(Exit.isFailure(exit) && Exit.findErrorOption(exit)._tag, 'None');
        assert.deepEqual(yield* consumer.tags, ['Entry:text']);
        assert.equal(fake.calls.closed, 1);
      }),
    ));

  it('fails with ClaudeStartup when query throws', () =>
    run(
      Effect.gen(function* () {
        const query: QueryFunction = () => {
          throw new Error('spawn failed');
        };
        const consumer = yield* consume(
          connectWith(query, { executable, environment })(worker, Stream.never),
        );
        assert.deepEqual(
          yield* Fiber.await(consumer.fiber),
          Exit.fail(new ToolFault({ reason: 'ClaudeStartup' })),
        );
      }),
    ));
});
