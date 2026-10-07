import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  Effect,
  Exit,
  Fiber,
  Option,
  Ref,
  Schedule,
  Scope,
  Stream,
  type Scope as ScopeType,
} from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { uuidv7, type Action } from '@yourtechbudstudio/fluidcast-core/actions';
import { ToolError, ToolFault } from '@yourtechbudstudio/fluidcast-harness';
import { ExecutionId } from '@yourtechbudstudio/fluidcast-harness/protocol';

import {
  actions,
  eventually,
  fakeModel,
  fakeWorkerType,
  forwardCall,
  stateOf,
  user,
  type FakeConnection,
} from './fixtures.test.ts';
import { forwardAgentTool, type ForwardAgentToolOptions } from './forward-tool.ts';
import type { Handoff } from './handoff.ts';
import {
  forwardErrorMessage,
  WorkerSetupError,
  type TranscriptEntry,
  type TranscriptMessage,
  type WorkerSummary,
} from './index.ts';

const text = (value: string, parentToolUseId: string | null = null): TranscriptEntry => ({
  _tag: 'text',
  parentToolUseId,
  text: value,
});
const turnEnd = (outcome = 'success'): TranscriptEntry => ({
  _tag: 'turnEnd',
  parentToolUseId: null,
  outcome,
});
const entry = (value: TranscriptEntry) => ({ _tag: 'Entry', entry: value }) as const;
const consumed = (...ids: ReadonlyArray<string>) => ({ _tag: 'Consumed', ids }) as const;
const settled = { _tag: 'Settled' } as const;

type Options = Omit<ForwardAgentToolOptions, 'worker'>;

/** A Forward tool over a fake worker type, driven the way the Harness drives it. */
const setup = (options: Options & { readonly fake?: Parameters<typeof fakeWorkerType>[0] } = {}) =>
  Effect.gen(function* () {
    const fake = yield* fakeWorkerType(options.fake);
    const model = yield* fakeModel;
    const { tool, worker } = yield* forwardAgentTool({ worker: fake.type, ...options }).pipe(
      Effect.provideService(LanguageModel.LanguageModel, model),
    );
    const log = yield* Ref.make<ReadonlyArray<Action>>([]);
    const progress = yield* Ref.make<ReadonlyArray<string>>([]);

    /** A reached call: `assign`, then `run` when it opened a new execution. */
    const send = (handle: string) =>
      Effect.gen(function* () {
        const [call] = actions(forwardCall(handle));
        const state = stateOf(yield* Ref.updateAndGet(log, (all) => [...all, call!]));
        const input = {};
        const proposed = ExecutionId.make(uuidv7());
        const executionId = yield* tool.assign!(input, { handle, state, executionId: proposed });
        if (executionId !== proposed) return { executionId, joined: true as const };
        // In the test's scope, so it outlives a concurrent branch that sent the call.
        const fiber = yield* Effect.forkScoped(
          tool.run(input, {
            handle,
            executionId,
            awaitCommand: Effect.never,
            progress: (value) =>
              Ref.update(progress, (all) => [...all, value]).pipe(Effect.as(true)),
          }),
        );
        return { executionId, joined: false as const, fiber };
      });

    /** The `index`-th connection, once it is open. */
    const connection = (index = 0) =>
      eventually(fake.connections, (all) => all.length > index).pipe(
        Effect.map((all) => all[index]!),
      );

    /** The IDs of the messages a connection has read, once there are `count`. */
    const ids = (open: FakeConnection, count: number) =>
      eventually(open.received, (all) => all.length >= count).pipe(
        Effect.map((all) => all.map((message) => message.id)),
      );

    const snapshot = Stream.runHead(worker.transcript).pipe(Effect.map(Option.getOrThrow));

    return {
      tool,
      worker,
      fake,
      send,
      connection,
      ids,
      snapshot,
      log,
      progress: Ref.get(progress),
      context: tool.context!,
    };
  });

const run = <A, E>(effect: Effect.Effect<A, E, ScopeType.Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

/** Whether the fiber has not completed yet, after letting the session process what was pushed. */
const stillRunning = (fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.gen(function* () {
    yield* Effect.sleep('20 millis');
    return fiber.pollUnsafe() === undefined;
  });

const working = 'The agent is working.';

describe('worker session', () => {
  it('starts idle, sends the first hand-off, reports it working and delivers its text', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        assert.equal(yield* ctx.context, undefined, 'an idle worker adds no context');
        const [idle] = yield* Stream.runHead(ctx.worker.status).pipe(Effect.map(Option.toArray));
        assert.deepEqual(idle, { _tag: 'WorkerSummary', status: 'idle', sessionId: null });
        assert.equal(
          (yield* ctx.fake.connections).length,
          0,
          'nothing is spawned before a forward',
        );

        const sent = yield* ctx.send('call_1');
        assert.ok(!sent.joined);
        assert.equal(yield* ctx.context, working);

        const open = yield* ctx.connection();
        assert.deepEqual(open.worker, { cwd: '/work', resume: undefined });
        const [message] = yield* eventually(open.received, (all) => all.length === 1);
        assert.ok(
          message!.text.startsWith('The user is talking with you through a voice conversation.'),
        );
        const [summary] = yield* Stream.runHead(ctx.worker.status).pipe(Effect.map(Option.toArray));
        assert.equal(summary?.status, 'working');

        yield* open.emit(
          consumed(message!.id),
          entry(text('One.')),
          entry({
            _tag: 'toolCall',
            parentToolUseId: null,
            toolUseId: 't1',
            name: 'Read',
            input: '{}',
            truncated: false,
          }),
          entry(text('Nested.', 't1')),
          entry(text('Two.')),
          entry(turnEnd()),
          settled,
        );
        assert.deepEqual(yield* Fiber.join(sent.fiber), { messages: ['One.', 'Two.'] });
        assert.equal(yield* ctx.context, undefined);
      }),
    ));

  it('joins the busy worker and delivers one result once every message sent was consumed', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const first = yield* ctx.send('call_1');
        assert.ok(!first.joined);
        const open = yield* ctx.connection();
        const second = yield* ctx.send('call_2');
        assert.deepEqual(second, { executionId: first.executionId, joined: true });
        const [one, two] = yield* ctx.ids(open, 2);
        assert.ok(
          (yield* open.received)[1]!.text.startsWith(
            'Here is the voice conversation since the last message you received from it.',
          ),
        );

        // A pure-text turn took in only the first message: its result is superseded.
        yield* open.emit(consumed(one!), entry(text('First answer.')), entry(turnEnd()), settled);
        assert.ok(yield* stillRunning(first.fiber));
        assert.equal(yield* ctx.context, working);

        yield* open.emit(consumed(two!), entry(text('Steered answer.')), entry(turnEnd()), settled);
        assert.deepEqual(yield* Fiber.join(first.fiber), {
          messages: ['First answer.', 'Steered answer.'],
        });
        // One reader for the worker's whole life.
        yield* ctx.send('call_3');
        yield* ctx.ids(open, 3);
        assert.equal((yield* ctx.fake.connections).length, 1);
      }),
    ));

  it('carries an unsolicited automatic turn into the next period, and supersedes its result', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const first = yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        const [one] = yield* ctx.ids(open, 1);
        yield* open.emit(consumed(one!), entry(text('Done.')), entry(turnEnd()), settled);
        yield* Fiber.join(first.fiber);

        // An automatic turn starts after background work: text A has no period to join yet.
        yield* open.emit(entry(text('A')));
        yield* eventually(ctx.context, (value) => value === working);

        const next = yield* ctx.send('call_2');
        assert.ok(!next.joined);
        const [, two] = yield* ctx.ids(open, 2);
        // The automatic turn goes on (B) and ends before the new message is taken in.
        yield* open.emit(entry(text('B')), entry(turnEnd()), settled);
        assert.ok(yield* stillRunning(next.fiber));

        yield* open.emit(consumed(two!), entry(text('C')), entry(turnEnd()), settled);
        assert.deepEqual(yield* Fiber.join(next.fiber), { messages: ['A', 'B', 'C'] });
      }),
    ));

  it('delivers a completed automatic turn between forwards in the next result, exactly once', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const first = yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        const [one] = yield* ctx.ids(open, 1);
        yield* open.emit(consumed(one!), entry(text('Done.')), entry(turnEnd()), settled);
        assert.deepEqual(yield* Fiber.join(first.fiber), { messages: ['Done.'] });

        // A whole automatic turn, ended before the next forward.
        yield* open.emit(entry(text('Update.')), entry(turnEnd()), settled);
        yield* eventually(ctx.context, (value) => value !== working);

        const second = yield* ctx.send('call_2');
        const [, two] = yield* ctx.ids(open, 2);
        yield* open.emit(consumed(two!), entry(text('Reply.')), entry(turnEnd()), settled);
        assert.deepEqual(yield* Fiber.join(second.fiber), { messages: ['Update.', 'Reply.'] });

        const third = yield* ctx.send('call_3');
        const [, , three] = yield* ctx.ids(open, 3);
        yield* open.emit(consumed(three!), entry(text('Again.')), entry(turnEnd()), settled);
        assert.deepEqual(yield* Fiber.join(third.fiber), { messages: ['Again.'] });
      }),
    ));

  it('keeps the transcript in decision order when worker output races a new hand-off', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const first = yield* ctx.send('call_0');
        const open = yield* ctx.connection();
        const [id] = yield* ctx.ids(open, 1);
        yield* open.emit(consumed(id!), entry(turnEnd()), settled);
        yield* Fiber.join(first.fiber);

        let seen = 0;
        for (let round = 1; round <= 30; round++) {
          // Automatic-turn output and a new message race: whichever the session decides first
          // must come first in the transcript, and the result reads the texts in that order.
          const [, sent] = yield* Effect.all(
            [
              open.emit(entry(text(`late ${round}`))),
              // A varying head start for the worker's output, so rounds land on both sides.
              Effect.andThen(
                Effect.forEach(Array.from({ length: round % 8 }), () => Effect.yieldNow),
                ctx.send(`call_${round}`),
              ),
            ],
            { concurrency: 'unbounded' },
          );
          assert.ok(!sent.joined);
          const ids = yield* ctx.ids(open, round + 1);
          yield* open.emit(
            consumed(ids[round]!),
            entry(text(`reply ${round}`)),
            entry(turnEnd()),
            settled,
          );
          const result = yield* Fiber.join(sent.fiber);

          const snapshot = yield* ctx.snapshot;
          assert.equal(snapshot._tag, 'TranscriptSnapshot');
          const entries = snapshot._tag === 'TranscriptSnapshot' ? snapshot.entries : [];
          const since = entries
            .slice(seen)
            .flatMap((item) => (item._tag === 'text' ? [item.text] : []));
          // `late` joins this round's result on either side of the hand-off, exactly once.
          assert.deepEqual(result.messages, since, `round ${round}`);
          assert.deepEqual([...since].sort(), [`late ${round}`, `reply ${round}`]);
          seen = entries.length;
        }
      }),
    ));

  it('turns an error turn end into a ToolError with what the worker wrote, and reports it failed', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const sent = yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        const [one] = yield* ctx.ids(open, 1);
        yield* open.emit(
          consumed(one!),
          entry(text('Partial.')),
          entry(turnEnd('error_max_turns')),
          settled,
        );
        assert.deepEqual(
          yield* Effect.exit(Fiber.join(sent.fiber)),
          Exit.fail(
            new ToolError({
              message: forwardErrorMessage({ outcome: 'error_max_turns', messages: ['Partial.'] }),
            }),
          ),
        );
        assert.equal(yield* ctx.context, "The agent's last turn stopped with an error.");
      }),
    ));

  it('names the usage limit reset time in the ToolError of a usage_limit turn end', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const sent = yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        const [one] = yield* ctx.ids(open, 1);
        yield* open.emit(
          consumed(one!),
          entry({
            _tag: 'turnEnd',
            parentToolUseId: null,
            outcome: 'usage_limit',
            resetsAt: 1_790_000_000,
          }),
          settled,
        );
        assert.deepEqual(
          yield* Effect.exit(Fiber.join(sent.fiber)),
          Exit.fail(
            new ToolError({
              message:
                'The work stopped with an error (usage_limit). The usage limit resets at 2026-09-21T14:13:20.000Z.',
            }),
          ),
        );
      }),
    ));

  it('reports a busy connection failure through run only, and refuses later calls with it', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const faults = yield* Effect.forkChild(Stream.runCollect(ctx.tool.faults!));
        const sent = yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        yield* ctx.ids(open, 1);
        const fault = new ToolFault({ reason: 'ClaudeExited' });
        yield* open.fail(fault);
        assert.deepEqual(yield* Effect.exit(Fiber.join(sent.fiber)), Exit.fail(fault));
        assert.equal(yield* ctx.context, "The agent's last turn stopped with an error.");

        const again = yield* ctx.send('call_2');
        assert.ok(!again.joined);
        assert.deepEqual(yield* Effect.exit(Fiber.join(again.fiber)), Exit.fail(fault));
        assert.equal((yield* open.received).length, 1);
        assert.ok(yield* stillRunning(faults), 'nothing reached faults');
      }),
    ));

  for (const [how, fault] of [
    ['fails', new ToolFault({ reason: 'ClaudeExited' })],
    ['ends', new ToolFault({ reason: 'WorkerEnded' })],
  ] as const) {
    it(`reports an idle connection that ${how} through faults, exactly once`, () =>
      run(
        Effect.gen(function* () {
          const ctx = yield* setup();
          const faults = yield* Effect.forkChild(
            Stream.runCollect(ctx.tool.faults!.pipe(Stream.take(1))),
          );
          const sent = yield* ctx.send('call_1');
          const open = yield* ctx.connection();
          const [id] = yield* ctx.ids(open, 1);
          yield* open.emit(consumed(id!), entry(turnEnd()), settled);
          yield* Fiber.join(sent.fiber);
          if (how === 'fails') yield* open.fail(fault);
          else yield* open.end;
          assert.deepEqual(yield* Fiber.join(faults), [fault]);
          const more = yield* Effect.forkChild(Stream.runCollect(ctx.tool.faults!));
          assert.ok(yield* stillRunning(more), 'reported once');
          yield* Fiber.interrupt(more);
        }),
      ));
  }

  it('gives the hook the conversation and sends what the worker type composes from its modifiers', () =>
    run(
      Effect.gen(function* () {
        const seen: Array<Handoff> = [];
        const ctx = yield* setup({
          hook: (handoff) => {
            seen.push(handoff);
            return {
              prompt: `P:${handoff.conversation.length}`,
              modifiers: [{ name: 'a' }, { name: 'b' }],
            };
          },
          fake: {
            composeMessage: (prompt, modifiers) =>
              [...modifiers.map((modifier) => `/${modifier.name}`), prompt].join(' '),
          },
        });
        yield* Ref.set(ctx.log, actions(user('Hello.')));
        yield* ctx.send('call_1');
        yield* Ref.update(ctx.log, (all) => [...all, ...actions(user('Faster, please.'))]);
        yield* ctx.send('call_2');
        const open = yield* ctx.connection();
        const received = yield* eventually(open.received, (all) => all.length === 2);
        assert.deepEqual(
          received.map((message) => message.text),
          ['/a /b P:1', '/a /b P:1'],
        );
        assert.deepEqual(
          seen.map(({ conversation, isFirstMessage }) => ({ conversation, isFirstMessage })),
          [
            { conversation: [{ kind: 'user', text: 'Hello.' }], isFirstMessage: true },
            { conversation: [{ kind: 'user', text: 'Faster, please.' }], isFirstMessage: false },
          ],
        );
        assert.ok(seen[0]!.rendered.includes('**User:** Hello.'));
        // The transcript shows exactly what was sent, before any reply.
        const snapshot = yield* ctx.snapshot;
        assert.deepEqual(snapshot._tag === 'TranscriptSnapshot' && snapshot.entries, [
          { _tag: 'prompt', parentToolUseId: null, source: 'fluidcast', text: '/a /b P:1' },
          { _tag: 'prompt', parentToolUseId: null, source: 'fluidcast', text: '/a /b P:1' },
        ]);
      }),
    ));

  it('dies in assign, sending nothing, when composeMessage throws', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup({
          fake: {
            composeMessage: () => {
              throw new Error('too many modifiers');
            },
          },
        });
        const exit = yield* Effect.exit(ctx.send('call_1'));
        assert.ok(Exit.isFailure(exit) && Exit.hasDies(exit));
        assert.equal(yield* ctx.context, undefined);
        assert.equal((yield* ctx.fake.connections).length, 0);
      }),
    ));

  it('streams the transcript as a snapshot then appends', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        yield* ctx.ids(open, 1);
        const received = yield* Ref.make<ReadonlyArray<TranscriptMessage>>([]);
        yield* Effect.forkChild(
          Stream.runForEach(ctx.worker.transcript, (message) =>
            Ref.update(received, (all) => [...all, message]),
          ),
        );
        yield* eventually(Ref.get(received), (all) => all.length === 1);
        yield* open.emit(entry(text('One.')));
        yield* open.emit(entry(text('Two.')), entry(text('Three.')));
        const texts = (all: ReadonlyArray<TranscriptMessage>) =>
          all
            .flatMap((message) => message.entries)
            .map((item) => (item._tag === 'text' ? item.text : item._tag));
        const messages = yield* eventually(Ref.get(received), (all) => texts(all).length === 4);
        assert.equal(messages[0]?._tag, 'TranscriptSnapshot');
        assert.ok(messages.slice(1).every((message) => message._tag === 'TranscriptAppended'));
        assert.deepEqual(texts(messages), ['prompt', 'One.', 'Two.', 'Three.']);
      }),
    ));

  it('has no session ID until the agent reports it, which changes neither status nor transcript', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const summaries = yield* Ref.make<ReadonlyArray<WorkerSummary>>([]);
        yield* Effect.forkChild(
          Stream.runForEach(ctx.worker.status, (summary) =>
            Ref.update(summaries, (all) => [...all, summary]),
          ),
        );
        yield* eventually(Ref.get(summaries), (all) => all.length === 1);
        const sent = yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        const [id] = yield* ctx.ids(open, 1);
        yield* eventually(Ref.get(summaries), (all) => all.length === 2);
        const before = (yield* ctx.snapshot).entries;

        yield* open.emit({ _tag: 'SessionStarted', sessionId: 'agent-session' });
        const seen = yield* eventually(Ref.get(summaries), (all) => all.length === 3);
        assert.deepEqual(seen, [
          { _tag: 'WorkerSummary', status: 'idle', sessionId: null },
          { _tag: 'WorkerSummary', status: 'working', sessionId: null },
          { _tag: 'WorkerSummary', status: 'working', sessionId: 'agent-session' },
        ]);
        assert.deepEqual((yield* ctx.snapshot).entries, before, 'no transcript entry');

        yield* open.emit(consumed(id!), entry(text('Done.')), entry(turnEnd()), settled);
        assert.deepEqual(yield* Fiber.join(sent.fiber), { messages: ['Done.'] });
        const [idle] = yield* Stream.runHead(ctx.worker.status).pipe(Effect.map(Option.toArray));
        assert.deepEqual(idle, {
          _tag: 'WorkerSummary',
          status: 'idle',
          sessionId: 'agent-session',
        });
      }),
    ));

  it('reports a session ID with no period open without making the worker busy', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const sent = yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        const [id] = yield* ctx.ids(open, 1);
        yield* open.emit(consumed(id!), entry(turnEnd()), settled);
        yield* Fiber.join(sent.fiber);
        yield* open.emit({ _tag: 'SessionStarted', sessionId: 'agent-session' });
        const summary = yield* eventually(
          Stream.runHead(ctx.worker.status).pipe(Effect.map(Option.getOrThrow)),
          (current) => current.sessionId !== null,
        );
        assert.deepEqual(summary, {
          _tag: 'WorkerSummary',
          status: 'idle',
          sessionId: 'agent-session',
        });
        assert.equal(yield* ctx.context, undefined);
      }),
    ));

  it('offers progress while a period runs and stops when it ends', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup({ progress: { schedule: Schedule.spaced('5 millis') } });
        const sent = yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        const [id] = yield* ctx.ids(open, 1);
        yield* Effect.sleep('20 millis');
        assert.deepEqual(yield* ctx.progress, [], 'the hand-off alone is not activity');
        yield* open.emit(entry(text('Reading.')));
        yield* eventually(ctx.progress, (all) => all.length === 1);
        assert.deepEqual(yield* ctx.progress, ['Working through the plan.']);
        yield* open.emit(consumed(id!), entry(text('More.')), entry(turnEnd()), settled);
        yield* Fiber.join(sent.fiber);
        const after = (yield* ctx.progress).length;
        yield* Effect.sleep('30 millis');
        assert.equal((yield* ctx.progress).length, after);
      }),
    ));

  it('closes the connection on teardown without recording a fault', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const ctx = yield* setup().pipe(Scope.provide(scope));
        const faults = yield* Effect.forkChild(Stream.runCollect(ctx.tool.faults!));
        yield* ctx.send('call_1').pipe(Scope.provide(scope));
        const open = yield* ctx.connection();
        yield* ctx.ids(open, 1);
        yield* Scope.close(scope, Exit.void);
        assert.equal(yield* open.closed, true);
        assert.ok(yield* stillRunning(faults));
        yield* Fiber.interrupt(faults);
      }),
    ));
});

describe('worker session preload', () => {
  const history: ReadonlyArray<TranscriptEntry> = [
    { _tag: 'prompt', parentToolUseId: null, source: 'earlier', text: 'Earlier.' },
    text('Earlier answer.'),
  ];
  const sessions = { 'session-1': { cwd: '/elsewhere', history } };

  it('attaches a session: its history, directory and a resumed first message', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup({ fake: { sessions }, session: { sessionId: 'session-1' } });
        const [summary] = yield* Stream.runHead(ctx.worker.status).pipe(Effect.map(Option.toArray));
        assert.deepEqual(summary, {
          _tag: 'WorkerSummary',
          status: 'idle',
          sessionId: 'session-1',
        });
        assert.equal(yield* ctx.context, undefined);
        assert.deepEqual(yield* ctx.snapshot, { _tag: 'TranscriptSnapshot', entries: history });
        assert.equal((yield* ctx.fake.connections).length, 0, 'nothing is spawned');
        yield* ctx.send('call_1');
        const open = yield* ctx.connection();
        assert.deepEqual(open.worker, { cwd: '/elsewhere', resume: 'session-1' });
        const [message] = yield* eventually(open.received, (all) => all.length === 1);
        assert.ok(
          message!.text.startsWith('The user is talking with you through a voice conversation.'),
        );
      }),
    ));

  it('fails setup for a session it cannot attach', async () => {
    assert.deepEqual(
      await Effect.runPromise(
        Effect.scoped(
          Effect.flip(setup({ fake: { sessions }, session: { sessionId: 'missing' } })),
        ),
      ),
      new WorkerSetupError({ sessionId: 'missing', reason: 'SessionNotFound' }),
    );
  });
});
