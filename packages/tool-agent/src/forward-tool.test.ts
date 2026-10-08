import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Context, Effect, Layer, Queue, Ref, Schema, type Scope, Stream } from 'effect';
import { LanguageModel, type Prompt, type Response } from 'effect/ai';

import { checkTools } from '@yourtechbudstudio/fluidcast-core/generation';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { layer, Session, type SessionState } from '@yourtechbudstudio/fluidcast-harness';
import {
  derivePhase,
  reduce as reduceEvent,
  type SubscriptionMessage,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

import { eventually, fakeModel, fakeWorkerType } from './fixtures.test.ts';
import { ForwardInput, forwardAgentTool, forwardToolName, type WorkerType } from './index.ts';

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
 * A real Harness session with the Forward tool over a fake worker type. The worker session is
 * acquired first, in the same scope, so it outlives the Harness session.
 */
const setup = (type?: Partial<WorkerType>, options: { readonly play?: boolean } = {}) =>
  Effect.gen(function* () {
    const fake = yield* fakeWorkerType();
    const progressModel = yield* fakeModel;
    const forward = yield* forwardAgentTool({ worker: { ...fake.type, ...type } }).pipe(
      Effect.provideService(LanguageModel.LanguageModel, progressModel),
    );
    const interfaceModel = yield* scriptedModel;
    const context = yield* Layer.build(
      layer({
        instructions: 'Be brief.',
        speakers: [{ id: 'host', name: 'Host', personality: 'Warm.', voice: { name: 'alloy' } }],
        speechFormat: 'opus',
        tools: [forward.tool],
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
    // Plays every line at once (the client's part), unless the test holds playback.
    yield* Effect.forkScoped(
      Stream.runForEach(session.subscribe(), (message) =>
        Ref.update(messages, (all) => [...all, message]).pipe(
          Effect.andThen(
            message._tag === 'PlaybackRequested' && options.play !== false
              ? Effect.forkScoped(
                  Effect.ignore(
                    session.command({ _tag: 'PlaybackFinished', playbackId: message.playbackId }),
                  ),
                )
              : Effect.void,
          ),
        ),
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

const forward = { type: forwardToolName };
const say = (text: string) => ({ type: 'speak', speaker: 'host', text });

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

describe('forwardAgentTool in a Harness session', () => {
  it("starts the worker on a forward written first, with the listener's own words, before the line after it plays", () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup(undefined, { play: false });
        yield* ctx.interface.reply([forward, say('Let me think about that.')]);
        yield* ctx.session.command({
          _tag: 'SendMessage',
          text: 'Why are the invoice totals off by a few cents?',
        });
        yield* ctx.waitFor((current) => current.executions.length === 1);
        const [open] = yield* eventually(ctx.fake.connections, (all) => all.length === 1);
        const [message] = yield* eventually(open!.received, (all) => all.length === 1);
        // "Let me think about that." is still waiting to play.
        assert.equal(derivePhase(yield* ctx.state), 'speaking');
        assert.ok(
          message!.text.includes(
            '<conversation_so_far>\n**User:** Why are the invoice totals off by a few cents?\n</conversation_so_far>',
          ),
          message!.text,
        );
        // The output format declares it with no fields.
        const prompts = yield* eventually(ctx.interface.prompts, (all) => all.length === 1);
        assert.match(
          prompts[0]![0]!.text,
          /\*\/\ntype ForwardAgent = \{\n {2}type: "forward_agent";\n\};/,
        );
      }),
    ));

  it('folds a steering forward into the running work and answers both calls with one result', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setup();

        yield* ctx.interface.reply([forward, say('Let me look.')]);
        yield* ctx.session.command({ _tag: 'SendMessage', text: 'Help me design retries.' });
        yield* ctx.waitFor((current) => current.executions.length === 1);
        const [open] = yield* eventually(ctx.fake.connections, (all) => all.length === 1);
        const [first] = yield* eventually(open!.received, (all) => all.length === 1);

        // The listener interrupts while it works (the line has played); the model forwards again,
        // with a stray field.
        yield* ctx.waitFor((current) => derivePhase(current) === 'working');
        yield* ctx.session.command({ _tag: 'Interrupt' });
        yield* ctx.interface.reply([{ ...forward, task: 'stray' }, say('One moment.')]);
        yield* ctx.session.command({ _tag: 'SendMessage', text: 'Actually, the backend owns it.' });
        const joined = yield* ctx.waitFor((current) => current.executions[0]?.handles.length === 2);
        assert.equal(joined.executions.length, 1);
        assert.deepEqual(joined.executions[0]!.handles, ['call_1', 'call_2']);
        const [, second] = yield* eventually(open!.received, (all) => all.length === 2);
        assert.ok(
          second!.text.startsWith(
            'Here is the voice conversation since the last message you received from it.',
          ),
        );
        assert.ok(
          second!.text.includes(
            '**Voice:** Let me look.\n\n*(The user interrupted to say something.)*\n\n**User:** Actually, the backend owns it.',
          ),
          second!.text,
        );

        // The worker takes both messages in and settles: one result for both calls.
        yield* ctx.waitFor((current) => current.generation === 'idle');
        yield* ctx.interface.reply([]);
        yield* open!.emit(
          { _tag: 'Consumed', ids: [first!.id, second!.id] },
          {
            _tag: 'Entry',
            entry: {
              _tag: 'text',
              parentToolUseId: null,
              text: 'Backend retries.\n\n**Questions for you**\n1. Keep the client timer?',
            },
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
        const messages = prompts[2]!;
        const last = messages.findLast((message) => message.role === 'user')?.text ?? '';
        assert.ok(
          last.includes(
            '<tool_result calls="call_1 call_2" tool="forward_agent">Backend retries.\n\n**Questions for you**\n1. Keep the client timer?</tool_result>',
          ),
          last,
        );
        // Earlier forwards read back without the stray field.
        assert.ok(
          messages.some(
            (message) =>
              message.role === 'assistant' &&
              message.text.startsWith('[{"type":"forward_agent","call":"call_2"},'),
          ),
        );
        // The worker is idle again, so its context is cleared.
        assert.ok(!last.includes('<context tool="forward_agent">'), last);
        assert.ok(
          prompts[1]!
            .findLast((message) => message.role === 'user')
            ?.text.endsWith('<context tool="forward_agent">The agent is working.</context>'),
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
        yield* ctx.interface.reply([forward]);
        yield* ctx.session.command({ _tag: 'SendMessage', text: 'Hi' });
        const halted = yield* ctx.waitFor((current) => derivePhase(current) === 'halted');
        const faulted = halted.actions.find((action) => action.type === 'tool_faulted');
        assert.equal(faulted?.type === 'tool_faulted' && faulted.tool, 'forward_agent');
        assert.deepEqual(yield* ctx.fake.connections, []);
      }),
    ));
});

describe('forwardAgentTool', () => {
  it('has an empty input: the model writes `{"type":"forward_agent"}`', () =>
    run(
      Effect.gen(function* () {
        const fake = yield* fakeWorkerType();
        const { tool } = yield* forwardAgentTool({ worker: fake.type }).pipe(
          Effect.provideService(LanguageModel.LanguageModel, yield* fakeModel),
        );
        checkTools([tool]);
        assert.equal(tool.name, 'forward_agent');
        assert.equal(tool.input, ForwardInput);
        assert.deepEqual(Schema.decodeUnknownSync(ForwardInput)({}), {});
        assert.deepEqual(tool.renderCall?.({ task: 'stray' }), {});
        assert.deepEqual(tool.policy, { blocking: false, response: 'all', replay: false });
        assert.ok(
          tool.guidelines[0]?.startsWith(
            '`forward_agent` (just `{"type":"forward_agent"}`, no fields)',
          ),
        );
        assert.ok(tool.guidelines.every((guideline) => guideline.includes('`forward_agent`')));
      }),
    ));
});
