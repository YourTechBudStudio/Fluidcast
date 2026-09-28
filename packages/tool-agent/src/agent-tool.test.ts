import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Cause, Context, Effect, Exit, Layer, Queue, Ref, type Scope, Stream } from 'effect';
import { LanguageModel, type Prompt, type Response } from 'effect/unstable/ai';

import { checkTools } from '@yourtechbudstudio/fluidcast-core/generation';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { layer, Session, type SessionState } from '@yourtechbudstudio/fluidcast-harness';
import {
  derivePhase,
  reduce as reduceEvent,
  type SubscriptionMessage,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

import { eventually, fakeModel, fakeWorkerType } from './fixtures.test.ts';
import { agentTool, agentToolName, type WorkerType } from './index.ts';

/** A scripted interface model: each call takes the next reply the test queues, and records its prompt. */
const scriptedModel = Effect.gen(function* () {
  const replies = yield* Queue.unbounded<string>();
  const prompts = yield* Ref.make<ReadonlyArray<ReadonlyArray<{ role: string; text: string }>>>([]);
  const model = yield* LanguageModel.make({
    generateText: () => Effect.die('unused'),
    streamText: (options) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const reply = yield* Queue.take(replies);
          yield* Ref.update(prompts, (all) => [...all, options.prompt.content.map(flatten)]);
          return Stream.make<Response.StreamPartEncoded>({
            type: 'text-delta',
            id: 't',
            delta: reply,
          });
        }),
      ),
  });
  return {
    model,
    reply: (elements: ReadonlyArray<object>) => Queue.offer(replies, JSON.stringify(elements)),
    prompts: Ref.get(prompts),
  };
});

const flatten = (message: Prompt.Message) => ({
  role: message.role,
  text:
    typeof message.content === 'string'
      ? message.content
      : message.content.map((part) => ('text' in part ? part.text : '')).join(''),
});

const silence = SpeechSynthesizer.of({ synthesize: () => Stream.empty });

/**
 * A real Harness session with the Agent tool over a fake worker type. The pool is acquired first,
 * in the same scope, so it outlives the session.
 */
const setup = (type?: Partial<WorkerType>) =>
  Effect.gen(function* () {
    const fake = yield* fakeWorkerType();
    const progressModel = yield* fakeModel;
    const agents = yield* agentTool({ types: { claude: { ...fake.type, ...type } } }).pipe(
      Effect.provideService(LanguageModel.LanguageModel, progressModel),
    );
    const interfaceModel = yield* scriptedModel;
    const context = yield* Layer.build(
      layer({
        instructions: 'Be brief.',
        speakers: [{ id: 'host', name: 'Host', personality: 'Warm.', voice: { name: 'alloy' } }],
        speechFormat: 'opus',
        tools: [agents.tool],
      }).pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(LanguageModel.LanguageModel, interfaceModel.model),
            Layer.succeed(SpeechSynthesizer, silence),
          ),
        ),
      ),
    );
    const session = Context.get(context, Session);
    const messages = yield* Ref.make<ReadonlyArray<SubscriptionMessage>>([]);
    yield* Effect.forkScoped(
      Stream.runForEach(session.subscribe(), (message) =>
        Ref.update(messages, (all) => [...all, message]),
      ),
    );
    yield* eventually(Ref.get(messages), (all) => all.length > 0);
    const state = Ref.get(messages).pipe(
      Effect.map((all) => {
        const [first, ...rest] = all;
        assert.equal(first?._tag, 'Snapshot');
        let folded: SessionState = first.state;
        for (const message of rest) {
          if (message._tag === 'Snapshot' || message._tag === 'Superseded') break;
          folded = reduceEvent(folded, message);
        }
        return folded;
      }),
    );
    const waitFor = (done: (current: SessionState) => boolean) => eventually(state, done);
    return {
      session,
      fake,
      interface: interfaceModel,
      state,
      waitFor,
      messages: Ref.get(messages),
    };
  });

const agentCall = (agent: string, message: string) => ({
  type: agentToolName,
  agentType: 'claude',
  agent,
  message,
});

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

describe('agentTool in a Harness session', () => {
  it('folds a steering call into the running worker and answers both calls with one result', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();

        // The interface agent hands work to a new worker.
        yield* ctx.interface.reply([agentCall('brainstorm', 'Propose retry designs.')]);
        yield* ctx.session.command({ _tag: 'SendMessage', text: 'Help me design retries.' });
        const started = yield* ctx.waitFor((current) => current.executions.length === 1);
        assert.equal(derivePhase(started), 'working');
        const [open] = yield* eventually(ctx.fake.connections, (all) => all.length === 1);
        const [first] = yield* eventually(open!.received, (all) => all.length === 1);
        assert.ok(first!.text.includes('**User:** Help me design retries.'));

        // The user interrupts while it works and steers; the model sends to the same worker.
        yield* ctx.waitFor((current) => current.generation === 'idle');
        yield* ctx.session.command({ _tag: 'Interrupt' });
        yield* ctx.interface.reply([agentCall('brainstorm', 'The backend should own retries.')]);
        yield* ctx.session.command({ _tag: 'SendMessage', text: 'Actually, the backend owns it.' });
        const joined = yield* ctx.waitFor((current) => current.executions[0]?.handles.length === 2);
        assert.equal(joined.executions.length, 1);
        const handles = joined.executions[0]!.handles;
        assert.deepEqual(handles, ['call_1', 'call_2']);
        assert.ok(
          (yield* ctx.messages).some(
            (message) => message._tag === 'ToolJoined' && message.handle === 'call_2',
          ),
        );
        const [, second] = yield* eventually(open!.received, (all) => all.length === 2);
        assert.ok(second!.text.startsWith('The user responded through the voice conversation'));
        assert.ok(
          second!.text.includes(
            '*(The user interrupted to say something.)*\n\n**User:** Actually, the backend owns it.',
          ),
        );

        // The worker takes both messages in and settles: one result for both calls.
        yield* ctx.waitFor((current) => current.generation === 'idle');
        yield* ctx.interface.reply([]);
        yield* open!.emit(
          { _tag: 'Consumed', ids: [first!.id, second!.id] },
          {
            _tag: 'Entry',
            entry: { _tag: 'text', parentToolUseId: null, text: 'Backend retries.' },
          },
          { _tag: 'Entry', entry: { _tag: 'turnEnd', parentToolUseId: null, outcome: 'success' } },
          { _tag: 'Settled' },
        );
        const done = yield* ctx.waitFor((current) =>
          current.actions.some((action) => action.type === 'tool_result'),
        );
        const results = done.actions.filter((action) => action.type === 'tool_result');
        assert.deepEqual(
          results.map((action) => action.type === 'tool_result' && action.handles),
          [['call_1', 'call_2']],
        );
        const prompts = yield* eventually(ctx.interface.prompts, (all) => all.length === 3);
        const last = prompts[2]!.findLast((message) => message.role === 'user')?.text ?? '';
        assert.ok(
          last.includes(
            '<tool_result calls="call_1 call_2" tool="agent">Backend retries.</tool_result>',
          ),
          last,
        );
        assert.ok(
          last.endsWith('<context tool="agent">Workers:\n- brainstorm (claude): done</context>'),
          last,
        );
      }),
    ));

  it('halts the conversation when composing the message throws (a hook defect)', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup({
          composeMessage: () => {
            throw new Error('seven modifiers');
          },
        });
        yield* ctx.interface.reply([agentCall('brainstorm', 'Go.')]);
        yield* ctx.session.command({ _tag: 'SendMessage', text: 'Hi' });
        const halted = yield* ctx.waitFor((current) => derivePhase(current) === 'halted');
        const faulted = halted.actions.find((action) => action.type === 'tool_faulted');
        assert.equal(faulted?.type === 'tool_faulted' && faulted.tool, 'agent');
        assert.deepEqual(yield* ctx.fake.connections, []);
      }),
    ));
});

describe('agentTool', () => {
  it('builds a tool that passes checkTools, with guidelines naming each worker type', () =>
    run(
      Effect.gen(function* () {
        const fake = yield* fakeWorkerType();
        const { tool } = yield* agentTool({
          types: { claude: fake.type, codex: { ...fake.type, description: 'Another.' } },
        }).pipe(Effect.provideService(LanguageModel.LanguageModel, yield* fakeModel));
        checkTools([tool]);
        assert.deepEqual(tool.policy, { blocking: false, response: 'all', replay: false });
        assert.equal(
          tool.guidelines[0],
          'Use `agent` to hand work to a worker agent that does the real thinking and returns a detailed response. Worker types: `claude`: A fake worker; `codex`: Another.',
        );
        assert.equal(tool.guidelines.length, 4);
        assert.equal(
          tool.renderResult({ agent: 'a', messages: [] }),
          '(The worker wrote no text.)',
        );
        assert.equal(tool.renderResult({ agent: 'a', messages: ['One.', 'Two.'] }), 'One.\n\nTwo.');
      }),
    ));

  it('dies without worker types', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.flatMap(fakeModel, (model) =>
          agentTool({ types: {} }).pipe(Effect.provideService(LanguageModel.LanguageModel, model)),
        ),
      ),
    );
    assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
  });
});
