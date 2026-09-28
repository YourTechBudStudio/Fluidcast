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

import { agentTool, type AgentToolOptions } from './agent-tool.ts';
import {
  actions,
  agentCall,
  eventually,
  fakeModel,
  fakeWorkerType,
  stateOf,
  user,
  type FakeConnection,
} from './fixtures.test.ts';
import type { Handoff } from './handoff.ts';
import {
  agentErrorMessage,
  AgentSetupError,
  WorkerNotFound,
  type TranscriptEntry,
  type TranscriptMessage,
  type WorkerType,
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

type Options = Omit<AgentToolOptions<{ claude: WorkerType }>, 'types'>;

/** An Agent tool over a fake worker type, driven the way the Harness drives it. */
const setup = (options: Options & { readonly fake?: Parameters<typeof fakeWorkerType>[0] } = {}) =>
  Effect.gen(function* () {
    const fake = yield* fakeWorkerType(options.fake);
    const model = yield* fakeModel;
    const { tool, workers } = yield* agentTool({ types: { claude: fake.type }, ...options }).pipe(
      Effect.provideService(LanguageModel.LanguageModel, model),
    );
    const log = yield* Ref.make<ReadonlyArray<Action>>([]);
    const progress = yield* Ref.make<ReadonlyArray<string>>([]);

    /** A reached call: `assign`, then `run` when it opened a new execution. */
    const send = (handle: string, agent: string, message: string, agentType = 'claude') =>
      Effect.gen(function* () {
        const [call] = actions(agentCall(handle, agent, message, agentType));
        const state = stateOf(yield* Ref.updateAndGet(log, (all) => [...all, call!]));
        const input = { agentType, agent, message };
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

    const snapshot = (agent: string) =>
      Effect.flatMap(workers.transcript(agent), (stream) =>
        Stream.runHead(stream).pipe(Effect.map(Option.getOrThrow)),
      );

    return {
      tool,
      workers,
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

/** Whether the fiber has not completed yet, after letting the pool process what was pushed. */
const stillRunning = (fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.gen(function* () {
    yield* Effect.sleep('20 millis');
    return fiber.pollUnsafe() === undefined;
  });

describe('agent pool', () => {
  it('creates an unknown worker, lists it working, sends the hand-off and delivers its text', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        assert.equal(yield* ctx.context, undefined);
        const sent = yield* ctx.send('call_1', 'brainstorm', 'Suggest names.');
        assert.ok(!sent.joined);
        assert.equal(yield* ctx.context, 'Workers:\n- brainstorm (claude): working');

        const open = yield* ctx.connection();
        assert.equal(open.worker.resume, false);
        assert.equal(open.worker.cwd, '/work');
        const [message] = yield* eventually(open.received, (all) => all.length === 1);
        assert.ok(
          message!.text.startsWith('The user is talking with you through a voice conversation.'),
        );

        const [summary] = yield* Stream.runHead(ctx.workers.list).pipe(
          Effect.map(Option.getOrThrow),
        );
        assert.deepEqual(summary, {
          agent: 'brainstorm',
          agentType: 'claude',
          status: 'working',
          sessionId: open.worker.sessionId,
        });

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
        const result = yield* Fiber.join(sent.fiber);
        assert.deepEqual(result, { agent: 'brainstorm', messages: ['One.', 'Two.'] });
        assert.equal(yield* ctx.context, 'Workers:\n- brainstorm (claude): done');
      }),
    ));

  it('refuses a known id with another type as a ToolError, sending nothing', () =>
    run(
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);
        const second: WorkerType = {
          ...(yield* fakeWorkerType()).type,
          composeMessage: (prompt) => prompt,
        };
        const fake = yield* fakeWorkerType();
        const { tool } = yield* agentTool({
          types: { claude: fake.type, codex: second },
          hook: (handoff) => {
            Effect.runSync(Ref.update(calls, (count) => count + 1));
            return { prompt: handoff.rendered };
          },
        }).pipe(Effect.provideService(LanguageModel.LanguageModel, yield* fakeModel));
        const reach = (handle: string, agentType: string) =>
          Effect.gen(function* () {
            const executionId = ExecutionId.make(uuidv7());
            const input = { agentType, agent: 'brainstorm', message: 'Go.' };
            const state = stateOf(actions(agentCall(handle, 'brainstorm', 'Go.', agentType)));
            assert.equal(yield* tool.assign!(input, { handle, state, executionId }), executionId);
            return yield* Effect.exit(
              tool
                .run(input, {
                  handle,
                  executionId,
                  awaitCommand: Effect.never,
                  progress: () => Effect.succeed(false),
                })
                .pipe(Effect.timeout('20 millis')),
            );
          });
        yield* reach('call_1', 'claude');
        const refused = yield* reach('call_2', 'codex');
        assert.deepEqual(
          refused,
          Exit.fail(
            new ToolError({
              message:
                'The agent "brainstorm" is a claude agent, not a codex agent. Use another id for a new codex agent.',
            }),
          ),
        );
        assert.equal(yield* Ref.get(calls), 1);
        const [open] = yield* eventually(fake.connections, (all) => all.length === 1);
        assert.equal((yield* open!.received).length, 1);
      }),
    ));

  it('joins a busy worker and delivers one result once every message sent was consumed', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const first = yield* ctx.send('call_1', 'brainstorm', 'Start.');
        assert.ok(!first.joined);
        const open = yield* ctx.connection();
        const second = yield* ctx.send('call_2', 'brainstorm', 'Steer.');
        assert.deepEqual(second, { executionId: first.executionId, joined: true });
        const [one, two] = yield* ctx.ids(open, 2);
        assert.ok((yield* open.received)[1]!.text.startsWith('The user responded'));

        // A pure-text turn took in only the first message: its result is superseded.
        yield* open.emit(consumed(one!), entry(text('First answer.')), entry(turnEnd()), settled);
        assert.ok(yield* stillRunning(first.fiber));
        assert.equal(yield* ctx.context, 'Workers:\n- brainstorm (claude): working');

        yield* open.emit(consumed(two!), entry(text('Steered answer.')), entry(turnEnd()), settled);
        assert.deepEqual(yield* Fiber.join(first.fiber), {
          agent: 'brainstorm',
          messages: ['First answer.', 'Steered answer.'],
        });
        // One reader for the worker's whole life.
        yield* ctx.send('call_3', 'brainstorm', 'Again.');
        yield* ctx.ids(open, 3);
        assert.equal((yield* ctx.fake.connections).length, 1);
      }),
    ));

  it('carries the rest of an unsolicited automatic turn into the next period, and supersedes its result', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const first = yield* ctx.send('call_1', 'brainstorm', 'Start.');
        const open = yield* ctx.connection();
        const [one] = yield* ctx.ids(open, 1);
        yield* open.emit(consumed(one!), entry(text('Done.')), entry(turnEnd()), settled);
        yield* Fiber.join(first.fiber);

        // An automatic turn starts after background work: text A has no period to join.
        yield* open.emit(entry(text('A')));
        yield* eventually(ctx.context, (value) => value?.endsWith('working') === true);

        const next = yield* ctx.send('call_2', 'brainstorm', 'Next.');
        assert.ok(!next.joined);
        const [, two] = yield* ctx.ids(open, 2);
        // The automatic turn goes on (B) and ends before the new message is taken in.
        yield* open.emit(entry(text('B')), entry(turnEnd()), settled);
        assert.ok(yield* stillRunning(next.fiber));

        yield* open.emit(consumed(two!), entry(text('C')), entry(turnEnd()), settled);
        assert.deepEqual(yield* Fiber.join(next.fiber), {
          agent: 'brainstorm',
          messages: ['B', 'C'],
        });
      }),
    ));

  it('keeps the transcript in decision order when worker output races a new hand-off', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const first = yield* ctx.send('call_0', 'brainstorm', 'Start.');
        const open = yield* ctx.connection();
        const [id] = yield* ctx.ids(open, 1);
        yield* open.emit(consumed(id!), entry(turnEnd()), settled);
        yield* Fiber.join(first.fiber);

        for (let round = 1; round <= 30; round++) {
          // Automatic-turn output and a new message race: whichever the pool decides first
          // must come first in the transcript.
          const [, sent] = yield* Effect.all(
            [
              open.emit(entry(text(`late ${round}`))),
              // A varying head start for the worker's output, so rounds land on both sides.
              Effect.andThen(
                Effect.forEach(Array.from({ length: round % 8 }), () => Effect.yieldNow),
                ctx.send(`call_${round}`, 'brainstorm', `Round ${round}.`),
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

          const snapshot = yield* ctx.snapshot('brainstorm');
          assert.equal(snapshot._tag, 'TranscriptSnapshot');
          const entries = snapshot._tag === 'TranscriptSnapshot' ? snapshot.entries : [];
          const prompt = entries.findLastIndex((item) => item._tag === 'prompt');
          const afterPrompt = entries
            .slice(prompt + 1)
            .flatMap((item) => (item._tag === 'text' ? [item.text] : []));
          assert.deepEqual(result.messages, afterPrompt, `round ${round}`);
        }
      }),
    ));

  it('turns an error turn end into a ToolError with what the worker wrote, and lists it failed', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const sent = yield* ctx.send('call_1', 'brainstorm', 'Start.');
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
              message: agentErrorMessage({
                agent: 'brainstorm',
                outcome: 'error_max_turns',
                messages: ['Partial.'],
              }),
            }),
          ),
        );
        assert.equal(yield* ctx.context, 'Workers:\n- brainstorm (claude): failed');
      }),
    ));

  it('names the usage limit reset time in the ToolError of a usage_limit turn end', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const sent = yield* ctx.send('call_1', 'brainstorm', 'Start.');
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
                'The worker "brainstorm" stopped with an error (usage_limit). The usage limit resets at 2026-09-21T14:13:20.000Z.',
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
        const sent = yield* ctx.send('call_1', 'brainstorm', 'Start.');
        const open = yield* ctx.connection();
        yield* ctx.ids(open, 1);
        const fault = new ToolFault({ reason: 'ClaudeExited' });
        yield* open.fail(fault);
        assert.deepEqual(yield* Effect.exit(Fiber.join(sent.fiber)), Exit.fail(fault));
        assert.equal(yield* ctx.context, 'Workers:\n- brainstorm (claude): failed');

        const again = yield* ctx.send('call_2', 'brainstorm', 'Retry.');
        assert.ok(!again.joined);
        assert.deepEqual(yield* Effect.exit(Fiber.join(again.fiber)), Exit.fail(fault));
        assert.equal((yield* open.received).length, 1);
        assert.ok(yield* stillRunning(faults), 'nothing reached faults');
      }),
    ));

  it('reports an idle connection failure or end through faults, exactly once', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        const faults = yield* Effect.forkChild(
          Stream.runCollect(ctx.tool.faults!.pipe(Stream.take(2))),
        );
        for (const agent of ['one', 'two']) {
          const sent = yield* ctx.send(`call_${agent}`, agent, 'Start.');
          const open = yield* ctx.connection(agent === 'one' ? 0 : 1);
          const [id] = yield* ctx.ids(open, 1);
          yield* open.emit(consumed(id!), entry(turnEnd()), settled);
          yield* Fiber.join(sent.fiber);
          if (agent === 'one') yield* open.fail(new ToolFault({ reason: 'ClaudeExited' }));
          else yield* open.end;
        }
        assert.deepEqual(yield* Fiber.join(faults), [
          new ToolFault({ reason: 'ClaudeExited' }),
          new ToolFault({ reason: 'WorkerEnded' }),
        ]);
      }),
    ));

  it('gives the hook the pieces and sends what the worker type composes from its modifiers', () =>
    run(
      Effect.gen(function* () {
        const seen: Array<Handoff> = [];
        const ctx = yield* setup({
          hook: (handoff) => {
            seen.push(handoff);
            return {
              prompt: `P:${handoff.instruction}`,
              modifiers: [{ name: 'a' }, { name: 'b' }],
            };
          },
          fake: {
            composeMessage: (prompt, modifiers) =>
              [...modifiers.map((modifier) => `/${modifier.name}`), prompt].join(' '),
          },
        });
        yield* Ref.set(ctx.log, actions(user('Hello.')));
        yield* ctx.send('call_1', 'brainstorm', 'Start.');
        yield* ctx.send('call_2', 'brainstorm', 'Steer.');
        const open = yield* ctx.connection();
        const received = yield* eventually(open.received, (all) => all.length === 2);
        assert.deepEqual(
          received.map((message) => message.text),
          ['/a /b P:Start.', '/a /b P:Steer.'],
        );
        assert.deepEqual(
          seen.map(({ agentType, agent, instruction, conversation, isFirstMessage }) => ({
            agentType,
            agent,
            instruction,
            conversation,
            isFirstMessage,
          })),
          [
            {
              agentType: 'claude',
              agent: 'brainstorm',
              instruction: 'Start.',
              conversation: [{ kind: 'user', text: 'Hello.' }],
              isFirstMessage: true,
            },
            {
              agentType: 'claude',
              agent: 'brainstorm',
              instruction: 'Steer.',
              conversation: [],
              isFirstMessage: false,
            },
          ],
        );
        assert.ok(seen[0]!.rendered.includes('**User:** Hello.'));
        // The transcript shows exactly what was sent, before any reply.
        const snapshot = yield* ctx.snapshot('brainstorm');
        assert.deepEqual(snapshot._tag === 'TranscriptSnapshot' && snapshot.entries, [
          { _tag: 'prompt', parentToolUseId: null, source: 'fluidcast', text: '/a /b P:Start.' },
          { _tag: 'prompt', parentToolUseId: null, source: 'fluidcast', text: '/a /b P:Steer.' },
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
        const exit = yield* Effect.exit(ctx.send('call_1', 'brainstorm', 'Start.'));
        assert.ok(Exit.isFailure(exit) && Exit.hasDies(exit));
        assert.equal(yield* ctx.context, undefined);
      }),
    ));

  it('streams a transcript as a snapshot then appends, and rejects an unknown worker', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();
        assert.deepEqual(
          yield* Effect.flip(ctx.workers.transcript('nobody')),
          new WorkerNotFound({ agent: 'nobody' }),
        );
        yield* ctx.send('call_1', 'brainstorm', 'Start.');
        const open = yield* ctx.connection();
        yield* ctx.ids(open, 1);
        const stream = yield* ctx.workers.transcript('brainstorm');
        const received = yield* Ref.make<ReadonlyArray<TranscriptMessage>>([]);
        yield* Effect.forkChild(
          Stream.runForEach(stream, (message) => Ref.update(received, (all) => [...all, message])),
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
        assert.equal(
          messages[0]._tag === 'TranscriptSnapshot' && messages[0].sessionId,
          open.worker.sessionId,
        );
        assert.ok(messages.slice(1).every((message) => message._tag === 'TranscriptAppended'));
        assert.deepEqual(texts(messages), ['prompt', 'One.', 'Two.', 'Three.']);
      }),
    ));

  it('offers progress while a period runs and stops when it ends', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup({ progress: { schedule: Schedule.spaced('5 millis') } });
        const sent = yield* ctx.send('call_1', 'brainstorm', 'Start.');
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

  it('closes connections on teardown without recording a fault', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const ctx = yield* setup().pipe(Scope.provide(scope));
        const faults = yield* Effect.forkChild(Stream.runCollect(ctx.tool.faults!));
        yield* ctx.send('call_1', 'brainstorm', 'Start.').pipe(Scope.provide(scope));
        const open = yield* ctx.connection();
        yield* ctx.ids(open, 1);
        yield* Scope.close(scope, Exit.void);
        assert.equal(yield* open.closed, true);
        assert.ok(yield* stillRunning(faults));
        yield* Fiber.interrupt(faults);
      }),
    ));
});

describe('agent pool preload', () => {
  const history: ReadonlyArray<TranscriptEntry> = [
    { _tag: 'prompt', parentToolUseId: null, source: 'earlier', text: 'Earlier.' },
    text('Earlier answer.'),
  ];
  const sessions = { 'session-1': { cwd: '/elsewhere', history } };

  it('attaches a session: its history, directory and a resumed first message', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup({
          fake: { sessions },
          preload: [{ type: 'claude', agent: 'brainstorm', sessionId: 'session-1' }],
        });
        assert.equal(yield* ctx.context, 'Workers:\n- brainstorm (claude): done');
        const snapshot = yield* ctx.snapshot('brainstorm');
        assert.deepEqual(snapshot, {
          _tag: 'TranscriptSnapshot',
          agent: 'brainstorm',
          sessionId: 'session-1',
          entries: history,
        });
        assert.equal((yield* ctx.fake.connections).length, 0, 'nothing is spawned');
        yield* ctx.send('call_1', 'brainstorm', 'Continue.');
        const open = yield* ctx.connection();
        assert.deepEqual(open.worker, { sessionId: 'session-1', resume: true, cwd: '/elsewhere' });
        const [message] = yield* eventually(open.received, (all) => all.length === 1);
        assert.ok(
          message!.text.startsWith('The user is talking with you through a voice conversation.'),
        );
      }),
    ));

  const setupError = (preload: Options['preload']) =>
    Effect.runPromise(Effect.scoped(Effect.flip(setup({ fake: { sessions }, preload }))));

  it('rejects an invalid id, a duplicate id and an unknown session', async () => {
    assert.deepEqual(
      await setupError([{ type: 'claude', agent: 'Brainstorm', sessionId: 'session-1' }]),
      new AgentSetupError({ agent: 'Brainstorm', reason: 'InvalidAgentId' }),
    );
    assert.deepEqual(
      await setupError([
        { type: 'claude', agent: 'a', sessionId: 'session-1' },
        { type: 'claude', agent: 'a', sessionId: 'session-1' },
      ]),
      new AgentSetupError({ agent: 'a', reason: 'DuplicateAgent' }),
    );
    assert.deepEqual(
      await setupError([{ type: 'claude', agent: 'a', sessionId: 'missing' }]),
      new AgentSetupError({ agent: 'a', reason: 'SessionNotFound' }),
    );
  });
});
