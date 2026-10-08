import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Cause, Effect, Exit, Fiber, Layer, Queue, Ref, Schema, Scope, Stream } from 'effect';
import { LanguageModel, type Prompt, type Response } from 'effect/ai';
import { TestClock } from 'effect/testing';

import {
  makeActionId,
  type Action,
  type LabeledContext,
  type Speak,
  type UserMessage,
} from '@yourtechbudstudio/fluidcast-core/actions';
import type { ReminderEvent } from '@yourtechbudstudio/fluidcast-core/generation';
import {
  SpeechSynthesizer,
  type SpeechError,
  type SynthesizeRequest,
} from '@yourtechbudstudio/fluidcast-core/speech';

import { ToolError, ToolFault, type Tool, type ToolPolicy } from '../tool.ts';
import type { SessionConfig } from './config.ts';
import {
  canSend,
  CommandRejected,
  controls,
  currentAction,
  derivePhase,
  frontierPhase,
  effectiveActions,
  ExecutionId,
  PlaybackId,
  reduce,
  SpeechNotFound,
  ToolCommandRejected,
  type Command,
  type SessionState,
  type SubscriptionMessage,
} from './protocol.ts';
import { make } from './session.ts';

const config: SessionConfig = {
  instructions: 'Be brief.',
  speakers: [
    { id: 'host', name: 'Host', personality: 'Warm.', voice: { name: 'alloy' } },
    {
      id: 'guest',
      name: 'Guest',
      personality: 'Dry.',
      voice: { name: 'echo', instructions: 'Calm.' },
    },
  ],
  speechFormat: 'opus',
  tools: [],
};

const line = (speaker: string, text: string) => JSON.stringify({ type: 'speak', speaker, text });

// Scripted language model: every `streamText` call takes the next turn, whose parts the test pushes.

interface Turn {
  /** Pushes a text delta to the model's stream. */
  readonly say: (delta: string) => Effect.Effect<void>;
  /** Ends the stream with an in-stream error part, which Core reports as a provider failure. */
  readonly fail: Effect.Effect<void>;
  readonly end: Effect.Effect<void>;
  /** The prompt the model received, once it was called. */
  readonly prompt: Effect.Effect<ReadonlyArray<{ role: string; text: string }>>;
  /** How the model's stream ended, once it did. */
  readonly exit: Effect.Effect<Exit.Exit<unknown, unknown> | undefined>;
}

const scriptedModel = Effect.gen(function* () {
  const pending = yield* Queue.unbounded<{
    readonly parts: Queue.Queue<Response.StreamPartEncoded, Cause.Done>;
    readonly prompt: Ref.Ref<ReadonlyArray<{ role: string; text: string }> | undefined>;
    readonly exit: Ref.Ref<Exit.Exit<unknown, unknown> | undefined>;
  }>();
  const calls = yield* Ref.make(0);
  const model = yield* LanguageModel.make({
    generateText: () => Effect.die('unused'),
    streamText: (options) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* Ref.update(calls, (count) => count + 1);
          const turn = yield* Queue.take(pending);
          yield* Ref.set(turn.prompt, options.prompt.content.map(flatten));
          return Stream.fromQueue(turn.parts).pipe(
            Stream.onExit((exit) => Ref.set(turn.exit, exit)),
          );
        }),
      ),
  });
  /** Scripts the next model call. */
  const turn = Effect.gen(function* () {
    const parts = yield* Queue.unbounded<Response.StreamPartEncoded, Cause.Done>();
    const prompt = yield* Ref.make<ReadonlyArray<{ role: string; text: string }> | undefined>(
      undefined,
    );
    const exit = yield* Ref.make<Exit.Exit<unknown, unknown> | undefined>(undefined);
    yield* Queue.offer(pending, { parts, prompt, exit });
    const result: Turn = {
      say: (delta) => Effect.asVoid(Queue.offer(parts, { type: 'text-delta', id: 't', delta })),
      fail: Effect.andThen(Queue.offer(parts, { type: 'error', error: 'boom' }), Queue.end(parts)),
      end: Effect.asVoid(Queue.end(parts)),
      prompt: eventually(Ref.get(prompt), (value) => value !== undefined).pipe(
        Effect.map((value) => value ?? []),
      ),
      exit: Ref.get(exit),
    };
    return result;
  });
  /** How many times the model was called, scripted or not. */
  return { model, turn, calls: Ref.get(calls) };
});

const flatten = (message: Prompt.Message) => ({
  role: message.role,
  text:
    typeof message.content === 'string'
      ? message.content
      : message.content.map((part) => ('text' in part ? part.text : '')).join(''),
});

/** A synthesizer that encodes the request, so tests can see which voice was used. */
const fakeSynthesizer = SpeechSynthesizer.of({
  synthesize: (request: SynthesizeRequest) =>
    Stream.make(
      new TextEncoder().encode(
        `${request.voice.name}|${request.format}|${request.voice.instructions ?? ''}|${request.text}`,
      ),
    ),
});

/** Polls `effect` until `done` holds, failing after a second. */
const eventually = <A>(effect: Effect.Effect<A>, done: (value: A) => boolean) => {
  const origin = new Error('condition not reached within a second');
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const value = yield* effect;
      if (done(value)) return value;
      yield* Effect.sleep('1 millis');
    }
    return yield* Effect.die(origin);
  });
};

/** Builds a session with a scripted model and the given tools, plus helpers. */
const setupWith = (
  tools: SessionConfig['tools'],
  examples?: SessionConfig['examples'],
  reminders?: SessionConfig['reminders'],
  start?: SessionConfig['start'],
) =>
  Effect.gen(function* () {
    const { model, turn, calls } = yield* scriptedModel;
    const { service, state } = yield* make({
      ...config,
      tools,
      ...(examples === undefined ? {} : { examples }),
      ...(reminders === undefined ? {} : { reminders }),
      ...(start === undefined ? {} : { start }),
    }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(LanguageModel.LanguageModel, model),
          Layer.succeed(SpeechSynthesizer, fakeSynthesizer),
        ),
      ),
    );
    const command = (next: Command) => service.command(next);
    const waitFor = (done: (state: SessionState) => boolean) => eventually(state, done);
    return { session: service, state, command, waitFor, turn, calls };
  });

/** Builds a speech-only session with a scripted model, plus helpers. */
const setup = setupWith([]);

/** A running subscription that records every message it receives. */
const subscribe = (session: { subscribe: () => Stream.Stream<SubscriptionMessage> }) =>
  Effect.gen(function* () {
    const received = yield* Ref.make<ReadonlyArray<SubscriptionMessage>>([]);
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(session.subscribe(), (message) =>
        Ref.update(received, (all) => [...all, message]),
      ),
    );
    const messages = Ref.get(received);
    /** Waits for a message matching `predicate` and returns it. */
    const waitFor = <M extends SubscriptionMessage>(
      predicate: (message: SubscriptionMessage) => message is M,
    ) =>
      eventually(messages, (all) => all.some(predicate)).pipe(
        Effect.map((all) => all.findLast(predicate) as M),
      );
    // Returns once the subscription is registered, so later commands are observed.
    yield* eventually(messages, (all) => all.length > 0);
    return { fiber, messages, waitFor };
  });

type Subscription = Effect.Success<ReturnType<typeof subscribe>>;

const playbackRequestFor = (actionId: string) => (message: SubscriptionMessage) =>
  message._tag === 'PlaybackRequested' && message.actionId === actionId;

const isPlaybackRequest = (
  message: SubscriptionMessage,
): message is Extract<SubscriptionMessage, { _tag: 'PlaybackRequested' }> =>
  message._tag === 'PlaybackRequested';

/** Folds a subscription's messages the way a client does. */
const fold = (messages: ReadonlyArray<SubscriptionMessage>): SessionState => {
  const [first, ...rest] = messages;
  assert.equal(first?._tag, 'Snapshot');
  let folded = first.state;
  for (const message of rest) {
    if (message._tag === 'Snapshot') assert.fail('a second snapshot');
    if (message._tag === 'Superseded') break;
    folded = reduce(folded, message);
  }
  return folded;
};

/** Reducer agreement: folding the snapshot with every event received equals the session's state. */
const assertAgreement = (subscription: Subscription, state: Effect.Effect<SessionState>) =>
  Effect.gen(function* () {
    const actual = yield* state;
    const received = yield* eventually(subscription.messages, (all) =>
      isDeepStrictEqual(fold(all), actual),
    ).pipe(Effect.catchDefect(() => subscription.messages));
    assert.deepEqual(fold(received), actual);
  });

const isDeepStrictEqual = (a: unknown, b: unknown) => {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

const run = <A>(effect: Effect.Effect<A, unknown, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect));

const actionTypes = (state: SessionState) => state.actions.map((action) => action.type);

const speaksIn = (state: SessionState): ReadonlyArray<Speak> =>
  state.actions.filter((action): action is Speak => action.type === 'speak');

const rejection = <E>(effect: Effect.Effect<void, E>) => Effect.flip(effect);

describe('Session', () => {
  it('plays speaks in order, advancing only on the matching playbackFinished', () =>
    run(
      Effect.gen(function* () {
        const { session, state, command, waitFor, turn } = yield* setup;
        const subscription = yield* subscribe(session);
        const model = yield* turn;

        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${line('host', 'One.')},${line('guest', 'Two.')}]`);
        yield* model.end;
        const done = yield* waitFor(
          (current) => current.generation === 'idle' && current.actions.length === 3,
        );
        const [first, second] = speaksIn(done);
        assert.ok(first && second);

        const request = yield* subscription.waitFor(isPlaybackRequest);
        // The first messages: the snapshot, then the send, then the first line's playback request.
        const opening = (yield* subscription.messages).slice(0, 6).map((message) => message._tag);
        assert.deepEqual(opening, [
          'Snapshot',
          'GenerationChanged',
          'ActionAppended',
          'CursorMoved',
          'ActionAppended',
          'PlaybackRequested',
        ]);
        assert.equal(request.actionId, first.id);
        assert.equal(derivePhase(yield* state), 'speaking');

        // A stale ID is ignored.
        yield* command({ _tag: 'PlaybackFinished', playbackId: PlaybackId.make('stale') });
        assert.equal((yield* state).cursor, 1);

        yield* command({ _tag: 'PlaybackFinished', playbackId: request.playbackId });
        const next = yield* subscription.waitFor(
          (message): message is typeof request =>
            isPlaybackRequest(message) && message.actionId === second.id,
        );
        assert.equal((yield* state).cursor, 2);
        assert.notEqual(next.playbackId, request.playbackId);

        // Acknowledging the first playback again is stale too.
        yield* command({ _tag: 'PlaybackFinished', playbackId: request.playbackId });
        assert.equal((yield* state).cursor, 2);

        yield* command({ _tag: 'PlaybackFinished', playbackId: next.playbackId });
        const end = yield* state;
        assert.equal(end.cursor, 3);
        assert.equal(end.playback, null);
        assert.equal(derivePhase(end), 'idle');
        yield* assertAgreement(subscription, state);
      }),
    ));

  it('rejects commands that are invalid in the current phase', () =>
    run(
      Effect.gen(function* () {
        const { command, turn, waitFor } = yield* setup;
        assert.deepEqual(
          yield* rejection(command({ _tag: 'Interrupt' })),
          new CommandRejected({ command: 'Interrupt', phase: 'idle' }),
        );
        assert.deepEqual(
          yield* rejection(command({ _tag: 'RetryGeneration' })),
          new CommandRejected({ command: 'RetryGeneration', phase: 'idle' }),
        );
        yield* turn;
        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        yield* waitFor((current) => derivePhase(current) === 'working');
        assert.deepEqual(
          yield* rejection(command({ _tag: 'SendMessage', text: 'Again' })),
          new CommandRejected({ command: 'SendMessage', phase: 'working' }),
        );
      }),
    ));

  it('interrupts while speaking: trims the tail, appends interrupted and stops generation', () =>
    run(
      Effect.gen(function* () {
        const { session, state, command, waitFor, turn } = yield* setup;
        const subscription = yield* subscribe(session);
        const model = yield* turn;

        yield* command({ _tag: 'SendMessage', text: 'Tell me a story' });
        yield* model.say(`[${line('host', 'Once.')},${line('host', 'Upon.')}`);
        const generated = yield* waitFor((current) => current.actions.length === 3);
        const [heard, queued] = speaksIn(generated);
        assert.ok(heard && queued);
        yield* subscription.waitFor(isPlaybackRequest);

        yield* command({ _tag: 'Interrupt' });
        const after = yield* state;
        assert.deepEqual(actionTypes(after), ['user_message', 'speak', 'interrupted']);
        assert.equal(after.actions[1]?.id, heard.id);
        assert.deepEqual(after.actions[2], { ...after.actions[2], during: 'speech' });
        assert.equal(after.cursor, 3);
        assert.equal(after.playback, null);
        assert.equal(after.generation, 'idle');
        assert.equal(derivePhase(after), 'idle');
        const exit = yield* model.exit;
        assert.ok(
          exit !== undefined && Exit.hasInterrupts(exit),
          'the model stream was interrupted',
        );
        const trimmed = yield* subscription.waitFor(
          (message): message is Extract<SubscriptionMessage, { _tag: 'ActionsTrimmed' }> =>
            message._tag === 'ActionsTrimmed',
        );
        assert.equal(trimmed.from, 2);

        // Late output of the interrupted generation never reaches the log.
        yield* model.say(`,${line('host', 'Late.')}]`);
        yield* Effect.sleep('10 millis');
        assert.equal((yield* state).actions.length, 3);

        // The trimmed line is gone for speech and for the model.
        const missing = yield* Effect.flip(Stream.runDrain(session.speech(queued.id)));
        assert.deepEqual(missing, new SpeechNotFound({ actionId: queued.id }));
        const nextModel = yield* turn;
        yield* command({ _tag: 'SendMessage', text: 'Go on' });
        const prompt = yield* nextModel.prompt;
        assert.deepEqual(prompt.slice(1), [
          { role: 'user', text: '<user_message>Tell me a story</user_message>' },
          {
            role: 'assistant',
            text: JSON.stringify([{ type: 'speak', speaker: 'host', text: 'Once.' }]),
          },
          {
            role: 'user',
            text: '<notice>You were interrupted during your last line.</notice>\n<user_message>Go on</user_message>',
          },
        ]);
        yield* assertAgreement(subscription, state);
      }),
    ));

  it('interrupts while waiting, including while an append is racing for the lock', () =>
    run(
      Effect.gen(function* () {
        for (let round = 0; round < 40; round++) {
          const { session, state, command, waitFor, turn } = yield* setup;
          const subscription = yield* subscribe(session);
          const model = yield* turn;
          yield* command({ _tag: 'SendMessage', text: 'Hi' });
          yield* model.say('[');
          yield* waitFor((current) => current.generation === 'running');

          // The element closes while the interrupt is being applied; vary the interleaving.
          const interrupt = yield* Effect.forkChild(command({ _tag: 'Interrupt' }));
          for (let step = 0; step < round % 8; step++) yield* Effect.yieldNow;
          yield* model.say(line('host', 'Racing.'));
          const result = yield* Fiber.await(interrupt).pipe(Effect.timeout('1 second'));
          // The interrupt may land while waiting (nothing heard) or after the line arrived (speaking).
          assert.ok(Exit.isSuccess(result));

          const after = yield* state;
          assert.equal(after.actions.at(-1)?.type, 'interrupted');
          assert.ok(
            ['user_message,interrupted', 'user_message,speak,interrupted'].includes(
              actionTypes(after).join(),
            ),
          );
          assert.equal(after.cursor, after.actions.length);
          assert.equal(after.generation, 'idle');
          assert.equal(derivePhase(after), 'idle');
          yield* Effect.sleep('2 millis');
          assert.equal((yield* state).actions.length, after.actions.length);
          yield* assertAgreement(subscription, state);
        }
      }),
    ));

  it('plays buffered lines after a generation failure, then retries with a cut-off notice', () =>
    run(
      Effect.gen(function* () {
        const { session, state, command, waitFor, turn } = yield* setup;
        const subscription = yield* subscribe(session);
        const model = yield* turn;

        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${line('host', 'One.')},${line('guest', 'Two.')},`);
        yield* model.fail;
        const failed = yield* waitFor((current) => current.generation === 'failed');
        assert.deepEqual(actionTypes(failed), [
          'user_message',
          'speak',
          'speak',
          'generation_failed',
        ]);
        assert.deepEqual(
          failed.actions[3]?.type === 'generation_failed' && failed.actions[3].error,
          {
            tag: 'ProviderError',
            message: 'The model provider failed (ErrorPart).',
          },
        );
        // Both lines still play first.
        assert.equal(derivePhase(failed), 'speaking');
        assert.deepEqual(
          yield* rejection(command({ _tag: 'RetryGeneration' })),
          new CommandRejected({ command: 'RetryGeneration', phase: 'speaking' }),
        );
        yield* playThrough(subscription, command, state);
        assert.equal(derivePhase(yield* state), 'generationFailed');

        const retry = yield* turn;
        yield* command({ _tag: 'RetryGeneration' });
        assert.equal(derivePhase(yield* state), 'working');
        const prompt = yield* retry.prompt;
        assert.deepEqual(prompt.slice(1), [
          { role: 'user', text: '<user_message>Hi</user_message>' },
          {
            role: 'assistant',
            text: JSON.stringify([
              { type: 'speak', speaker: 'host', text: 'One.' },
              { type: 'speak', speaker: 'guest', text: 'Two.' },
            ]),
          },
          {
            role: 'user',
            text: '<notice>Your previous response was cut off after the last line. Continue from there.</notice>',
          },
        ]);
        // Action IDs never reach the model.
        const text = prompt.map((message) => message.text).join('\n');
        for (const action of (yield* state).actions) assert.ok(!text.includes(action.id));

        yield* retry.say(`[${line('host', 'Three.')}]`);
        yield* retry.end;
        yield* waitFor((current) => current.generation === 'idle');
        yield* playThrough(subscription, command, state);
        assert.equal(derivePhase(yield* state), 'idle');
        yield* assertAgreement(subscription, state);
      }),
    ));

  it('reads a retry that succeeds with no lines as a completed turn', () =>
    run(
      Effect.gen(function* () {
        const { session, state, command, waitFor, turn } = yield* setup;
        const subscription = yield* subscribe(session);
        const model = yield* turn;
        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.fail;
        yield* waitFor((current) => current.generation === 'failed');
        assert.equal(derivePhase(yield* state), 'generationFailed');

        const retry = yield* turn;
        yield* command({ _tag: 'RetryGeneration' });
        yield* retry.say('[]');
        const done = yield* waitFor((current) => current.generation === 'idle');
        // The failure stays in the log as a fact; the phase reflects the successful retry.
        assert.deepEqual(actionTypes(done), ['user_message', 'generation_failed']);
        assert.equal(derivePhase(done), 'idle');
        yield* assertAgreement(subscription, state);
      }),
    ));

  it('interrupts buffered lines after a generation failure', () =>
    run(
      Effect.gen(function* () {
        const { session, state, command, waitFor, turn } = yield* setup;
        const subscription = yield* subscribe(session);
        const model = yield* turn;
        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${line('host', 'One.')},${line('host', 'Two.')},`);
        yield* model.fail;
        yield* waitFor((current) => current.generation === 'failed');
        yield* subscription.waitFor(isPlaybackRequest);
        assert.equal(derivePhase(yield* state), 'speaking');

        yield* command({ _tag: 'Interrupt' });
        const after = yield* state;
        // The unplayed line and the failure never took effect, so both are trimmed.
        assert.deepEqual(actionTypes(after), ['user_message', 'speak', 'interrupted']);
        assert.equal(after.generation, 'idle');
        assert.equal(derivePhase(after), 'idle');
        yield* assertAgreement(subscription, state);
      }),
    ));

  it('carries the failure notice with a new message instead of a retry', () =>
    run(
      Effect.gen(function* () {
        const { session, state, command, waitFor, turn } = yield* setup;
        const subscription = yield* subscribe(session);
        const model = yield* turn;
        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say('[{"type":"speak","speaker":"nobody","text":"x"}]');
        yield* waitFor((current) => current.generation === 'failed');
        const failed = yield* state;
        assert.deepEqual(
          failed.actions[1]?.type === 'generation_failed' && failed.actions[1].error,
          {
            tag: 'InvalidAction',
            message: 'Line 1 of the reply was invalid (unknown_speaker).',
          },
        );
        assert.equal(derivePhase(failed), 'generationFailed');

        const next = yield* turn;
        yield* command({ _tag: 'SendMessage', text: 'Hello?' });
        assert.deepEqual((yield* next.prompt).slice(1), [
          {
            role: 'user',
            text: '<user_message>Hi</user_message>\n<notice>Your previous response failed before any lines were delivered. Respond again.</notice>\n<user_message>Hello?</user_message>',
          },
        ]);
        yield* assertAgreement(subscription, state);
      }),
    ));

  it("passes the application's reminders to generation", () =>
    run(
      Effect.gen(function* () {
        const { command, turn } = yield* setupWith([], undefined, (event) =>
          event._tag === 'UserMessage' ? `Mind "${event.text}".` : undefined,
        );
        const model = yield* turn;
        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        assert.deepEqual((yield* model.prompt).slice(1), [
          {
            role: 'user',
            text: '<user_message>Hi</user_message>\n<reminder>Mind "Hi".</reminder>',
          },
        ]);
      }),
    ));

  it('records a defect during generation as a failure instead of generating forever', () =>
    run(
      Effect.gen(function* () {
        const model = yield* LanguageModel.make({
          generateText: () => Effect.die('unused'),
          streamText: () => Stream.die('bug'),
        });
        const { service, state } = yield* make(config).pipe(
          Effect.provide(
            Layer.merge(
              Layer.succeed(LanguageModel.LanguageModel, model),
              Layer.succeed(SpeechSynthesizer, fakeSynthesizer),
            ),
          ),
        );
        yield* service.command({ _tag: 'SendMessage', text: 'Hi' });
        const failed = yield* eventually(state, (current) => current.generation === 'failed');
        assert.deepEqual(
          failed.actions[1]?.type === 'generation_failed' && failed.actions[1].error,
          {
            tag: 'UnexpectedError',
            message: 'The reply could not be generated.',
          },
        );
        assert.equal(derivePhase(failed), 'generationFailed');
      }),
    ));

  it('freezes the cursor without a subscriber while generation continues', () =>
    run(
      Effect.gen(function* () {
        const { session, state, command, waitFor, turn } = yield* setup;
        const model = yield* turn;

        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${line('host', 'One.')},${line('host', 'Two.')}]`);
        yield* model.end;
        const queued = yield* waitFor(
          (current) => current.generation === 'idle' && current.actions.length === 3,
        );
        assert.equal(queued.cursor, 1);
        assert.equal(queued.playback, null);

        // Subscribing yields the snapshot, then a request to play the line at the cursor.
        const first = yield* subscribe(session);
        const request = yield* first.waitFor(isPlaybackRequest);
        const [snapshot] = yield* first.messages;
        assert.deepEqual(snapshot, { _tag: 'Snapshot', state: queued });
        assert.equal(request.actionId, queued.actions[1]?.id);

        // Disconnecting freezes the cursor: even the matching acknowledgement is ignored.
        yield* Fiber.interrupt(first.fiber);
        yield* command({ _tag: 'PlaybackFinished', playbackId: request.playbackId });
        assert.equal((yield* state).cursor, 1);

        // Reconnecting replays the current line under a new playback ID.
        const second = yield* subscribe(session);
        const replay = yield* second.waitFor(isPlaybackRequest);
        assert.equal(replay.actionId, request.actionId);
        assert.notEqual(replay.playbackId, request.playbackId);
        yield* command({ _tag: 'PlaybackFinished', playbackId: request.playbackId });
        assert.equal((yield* state).cursor, 1);
        yield* command({ _tag: 'PlaybackFinished', playbackId: replay.playbackId });
        assert.equal((yield* state).cursor, 2);
        yield* assertAgreement(second, state);
      }),
    ));

  it('supersedes the previous subscriber', () =>
    run(
      Effect.gen(function* () {
        const { session, state, command, waitFor, turn } = yield* setup;
        const first = yield* subscribe(session);
        const model = yield* turn;
        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${line('host', 'One.')}]`);
        yield* model.end;
        yield* waitFor((current) => current.generation === 'idle');
        const old = yield* first.waitFor(isPlaybackRequest);

        const second = yield* subscribe(session);
        const replay = yield* second.waitFor(isPlaybackRequest);
        // The first subscription ends with `Superseded`.
        yield* Fiber.join(first.fiber).pipe(Effect.timeout('1 second'));
        const firstMessages = yield* first.messages;
        assert.equal(firstMessages.at(-1)?._tag, 'Superseded');
        // Its fold agrees with the snapshot the second subscription started from.
        const [snapshot] = yield* second.messages;
        assert.deepEqual(snapshot, { _tag: 'Snapshot', state: fold(firstMessages) });

        yield* command({ _tag: 'PlaybackFinished', playbackId: old.playbackId });
        assert.equal((yield* state).cursor, 1);
        yield* command({ _tag: 'PlaybackFinished', playbackId: replay.playbackId });
        assert.equal(derivePhase(yield* state), 'idle');
        yield* assertAgreement(second, state);
      }),
    ));

  it('streams speech for any speak in the log with the speaker voice', () =>
    run(
      Effect.gen(function* () {
        const { session, command, waitFor, turn } = yield* setup;
        const model = yield* turn;
        yield* command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${line('host', 'One.')},${line('guest', 'Two.')}]`);
        yield* model.end;
        const done = yield* waitFor((current) => current.generation === 'idle');
        const [host, guest] = speaksIn(done);
        assert.ok(host && guest);

        const text = (id: string) =>
          Stream.runCollect(session.speech(id)).pipe(
            Effect.map((chunks) => new TextDecoder().decode(Buffer.concat([...chunks]))),
          );
        // Queued lines can be fetched ahead of the cursor.
        assert.equal(yield* text(guest.id), 'echo|opus|Calm.|Two.');
        assert.equal(yield* text(host.id), 'alloy|opus||One.');

        const user = done.actions[0] as Action;
        const notFound: SpeechNotFound | SpeechError = yield* Effect.flip(text(user.id));
        assert.deepEqual(notFound, new SpeechNotFound({ actionId: user.id }));
      }),
    ));
});

/** Acknowledges playback requests until the cursor rests on no speak. */
const playThrough = (
  subscription: Subscription,
  command: (command: Command) => Effect.Effect<void, CommandRejected>,
  state: Effect.Effect<SessionState>,
) =>
  Effect.gen(function* () {
    for (;;) {
      const current = yield* state;
      const speak = current.actions[current.cursor];
      if (speak?.type !== 'speak') return;
      const request = yield* subscription.waitFor(
        (message): message is Extract<SubscriptionMessage, { _tag: 'PlaybackRequested' }> =>
          playbackRequestFor(speak.id)(message),
      );
      yield* command({ _tag: 'PlaybackFinished', playbackId: request.playbackId });
    }
  });

// Tools

/** Drives a fake execution: reply, fail with a `ToolError`, fault, or die. */
const Reply = Schema.Union([
  Schema.Struct({ reply: Schema.String }),
  Schema.Struct({ fail: Schema.String }),
  Schema.Struct({ fault: Schema.String }),
  Schema.Struct({ die: Schema.Boolean }),
]);
type Reply = typeof Reply.Type;

const Labelled = Schema.Struct({ label: Schema.String });
const Replied = Schema.Struct({ label: Schema.String, reply: Schema.String });

/** A fake tool that runs until a client command tells it how to end. */
const fakeTool = (
  name: string,
  policy: ToolPolicy,
  overrides: Partial<Tool<{ readonly label: string }, typeof Replied.Type, Reply>> = {},
): Tool<{ readonly label: string }, typeof Replied.Type, Reply> => ({
  name,
  input: Labelled,
  guidelines: [`Use \`${name}\`.`],
  result: Replied,
  renderResult: ({ label, reply }) => `${label}: ${reply}`,
  policy,
  command: () => Reply,
  run: (input, context) =>
    Effect.flatMap(context.awaitCommand, (command) => {
      if ('reply' in command) return Effect.succeed({ label: input.label, reply: command.reply });
      if ('fail' in command) return Effect.fail(new ToolError({ message: command.fail }));
      if ('fault' in command) return Effect.fail(new ToolFault({ reason: command.fault }));
      return Effect.die('tool bug');
    }),
  ...overrides,
});

/** Like Show: non-blocking, only errors reach the model, replayed. */
const view = fakeTool('view', { blocking: false, response: 'error', replay: true });
/** Like Ask: blocking, every outcome reaches the model, not replayed. */
const pick = fakeTool('pick', { blocking: true, response: 'all', replay: false });
/** Non-blocking, every outcome reaches the model. */
const fetch = fakeTool('fetch', { blocking: false, response: 'all', replay: false });
/** Non-blocking, the model reads nothing. */
const quiet = fakeTool('quiet', { blocking: false, response: 'none', replay: false });
/** Accepts only a reply equal to its input's label: the command schema depends on the input. */
const echo = fakeTool(
  'echo',
  { blocking: false, response: 'all', replay: false },
  { command: (input) => Schema.Struct({ reply: Schema.Literal(input.label) }) },
);
const brokenCommand = fakeTool(
  'broken_command',
  { blocking: false, response: 'all', replay: false },
  {
    command: () => {
      throw new Error('bug in command');
    },
  },
);
const brokenRun = fakeTool(
  'broken_run',
  { blocking: false, response: 'all', replay: false },
  {
    run: () => {
      throw new Error('bug in run');
    },
  },
);
const brokenRender = fakeTool(
  'broken_render',
  { blocking: false, response: 'all', replay: false },
  {
    run: (input) => Effect.succeed({ label: input.label, reply: 'x' }),
    renderResult: () => {
      throw new Error('bug in renderResult');
    },
  },
);

const allTools = [view, pick, fetch, quiet, echo, brokenCommand, brokenRun, brokenRender];

const call = (tool: string, label: string, extra: object = {}) =>
  JSON.stringify({ type: tool, label, ...extra });

const toolSetup = setupWith(allTools);

type Setup = Effect.Success<typeof toolSetup>;

/** The open execution of `handle`, once it is open. */
const executionOf = (ctx: Setup, handle: string) =>
  ctx
    .waitFor((current) =>
      current.executions.some((execution) => execution.handles.includes(handle)),
    )
    .pipe(
      Effect.map((current) => {
        const execution = current.executions.find((entry) => entry.handles.includes(handle));
        assert.ok(execution);
        return execution;
      }),
    );

/** Sends `payload` to the open execution of `handle`. */
const reply = (ctx: Setup, handle: string, payload: Reply) =>
  Effect.gen(function* () {
    const { executionId } = yield* executionOf(ctx, handle);
    yield* ctx.command({ _tag: 'ToolCommand', handle, executionId, payload });
    return executionId;
  });

/** Acknowledges the outstanding playback. */
const finishLine = (ctx: Setup) =>
  Effect.gen(function* () {
    const current = yield* ctx.waitFor((state) => state.playback !== null);
    assert.ok(current.playback);
    yield* ctx.command({ _tag: 'PlaybackFinished', playbackId: current.playback.playbackId });
  });

/** Once generation settles, acknowledges playback until nothing is presented, including replayed lines. */
const playAll = (ctx: Setup) =>
  Effect.gen(function* () {
    yield* ctx.waitFor((current) => current.generation !== 'running');
    for (;;) {
      const current = yield* ctx.state;
      if (currentAction(current)?.type !== 'speak') return;
      yield* finishLine(ctx);
    }
  });

/** Sends a message and scripts the complete reply. */
const exchange = (ctx: Setup, text: string, elements: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const model = yield* ctx.turn;
    yield* ctx.command({ _tag: 'SendMessage', text });
    yield* model.say(`[${elements.join(',')}]`);
    yield* model.end;
    yield* ctx.waitFor((current) => current.generation !== 'running');
    return model;
  });

/** Scripts the next model call's complete reply, without sending anything. */
const scriptNext = (ctx: Setup, elements: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const model = yield* ctx.turn;
    yield* Effect.forkChild(
      Effect.andThen(model.prompt, Effect.andThen(model.say(`[${elements.join(',')}]`), model.end)),
    );
    return model;
  });

/** The last user message of a prompt. */
const lastUser = (prompt: ReadonlyArray<{ role: string; text: string }>) =>
  prompt.findLast((message) => message.role === 'user')?.text;

const eventTags = (messages: ReadonlyArray<SubscriptionMessage>) =>
  messages.map((message) => message._tag);

/** Asserts that every prefix of the subscription's events from `from` up to `until` (exclusive) derives a phase other than `idle`. */
const assertNeverIdle = (
  messages: ReadonlyArray<SubscriptionMessage>,
  from: number,
  until: number,
) => {
  for (let end = from; end < until; end++) {
    const phase = derivePhase(fold(messages.slice(0, end + 1)));
    assert.notEqual(
      phase,
      'idle',
      `a false idle after ${eventTags(messages.slice(from, end + 1)).join(', ')}`,
    );
  }
};

describe('Session tools', () => {
  it('starts a call only after the cursor reaches it, and only once its call is effective', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [
          line('host', 'Look.'),
          call('view', 'a'),
          line('host', 'See?'),
        ]);
        assert.deepEqual((yield* ctx.state).executions, []);

        yield* finishLine(ctx);
        yield* subscription.waitFor(
          (message): message is Extract<SubscriptionMessage, { _tag: 'ToolStarted' }> =>
            message._tag === 'ToolStarted',
        );
        yield* subscription.waitFor(isPlaybackRequest);
        const messages = yield* subscription.messages;
        const started = messages.findIndex((message) => message._tag === 'ToolStarted');
        // The cursor moved onto the call, the call started, then the cursor moved on to the speak.
        assert.deepEqual(eventTags(messages.slice(started - 1, started + 3)), [
          'CursorMoved',
          'ToolStarted',
          'CursorMoved',
          'PlaybackRequested',
        ]);
        const before = fold(messages.slice(0, started));
        assert.equal(currentAction(before)?.type, 'tool_call');
        assert.ok(effectiveActions(before).some((action) => action.type === 'tool_call'));

        // A call appended at the cursor is reached by its append, with no extra move.
        yield* playAll(ctx);
        yield* reply(ctx, 'call_1', { reply: 'ok' });
        yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        yield* exchange(ctx, 'More', [call('view', 'b')]);
        yield* executionOf(ctx, 'call_2');
        yield* assertAgreement(subscription, ctx.state);
        const later = yield* subscription.messages;
        const appended = later.findLastIndex((message) => message._tag === 'ActionAppended');
        assert.deepEqual(eventTags(later.slice(appended, appended + 3)), [
          'ActionAppended',
          'ToolStarted',
          'CursorMoved',
        ]);
        yield* assertAgreement(subscription, ctx.state);

        // A late subscriber's snapshot carries the open execution.
        const second = yield* subscribe(ctx.session);
        const [snapshot] = yield* second.messages;
        assert.ok(snapshot?._tag === 'Snapshot');
        assert.deepEqual(snapshot.state.executions, (yield* ctx.state).executions);
        assert.deepEqual(snapshot.state.executions[0]?.handles, ['call_2']);
      }),
    ));

  it('delivers commands, and rejects stale and invalid ones', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('echo', 'yes')]);
        yield* scriptNext(ctx, [line('host', 'Done.')]);
        const execution = yield* executionOf(ctx, 'call_1');
        const send = (handle: string, executionId: string, payload: Schema.Json) =>
          rejection(
            ctx.command({
              _tag: 'ToolCommand',
              handle,
              executionId: ExecutionId.make(executionId),
              payload,
            }),
          );

        assert.deepEqual(
          yield* send('call_1', 'unknown', { reply: 'yes' }),
          new ToolCommandRejected({ executionId: 'unknown', reason: 'stale' }),
        );
        assert.deepEqual(
          yield* send('call_9', execution.executionId, { reply: 'yes' }),
          new ToolCommandRejected({ executionId: execution.executionId, reason: 'stale' }),
        );
        // The schema depends on the input: only this call's label is accepted.
        assert.deepEqual(
          yield* send('call_1', execution.executionId, { reply: 'no' }),
          new ToolCommandRejected({ executionId: execution.executionId, reason: 'invalid' }),
        );
        assert.equal((yield* ctx.state).executions.length, 1);

        yield* reply(ctx, 'call_1', { reply: 'yes' });
        const done = yield* ctx.waitFor((current) => current.executions.length === 0);
        assert.deepEqual(
          done.pendingResults.map((result) => result.type),
          ['tool_result'],
        );
        assert.deepEqual(
          yield* send('call_1', execution.executionId, { reply: 'yes' }),
          new ToolCommandRejected({ executionId: execution.executionId, reason: 'stale' }),
        );
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('rejects every command to a tool without a command schema as invalid', () =>
    run(
      Effect.gen(function* () {
        const { command: _command, ...rest } = view;
        const ctx = yield* setupWith([rest]);
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('view', 'a')]);
        const execution = yield* executionOf(ctx, 'call_1');
        assert.deepEqual(
          yield* rejection(
            ctx.command({
              _tag: 'ToolCommand',
              handle: 'call_1',
              executionId: execution.executionId,
              payload: { reply: 'x' },
            }),
          ),
          new ToolCommandRejected({ executionId: execution.executionId, reason: 'invalid' }),
        );
      }),
    ));

  it('honours each response policy', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [
          call('view', 'shown'),
          call('view', 'broken'),
          call('fetch', 'got'),
          call('fetch', 'lost'),
          call('quiet', 'q1'),
          call('quiet', 'q2'),
        ]);
        const next = yield* scriptNext(ctx, []);
        yield* reply(ctx, 'call_1', { reply: 'rendered' });
        yield* reply(ctx, 'call_2', { fail: 'bad diagram' });
        yield* reply(ctx, 'call_3', { reply: 'data' });
        yield* reply(ctx, 'call_4', { fail: 'offline' });
        yield* reply(ctx, 'call_5', { reply: 'unheard' });
        yield* reply(ctx, 'call_6', { fail: 'unheard' });
        // Every outcome goes in one submission, in completion order.
        assert.equal(
          lastUser(yield* next.prompt),
          [
            '<tool_error call="call_2" tool="view">bad diagram</tool_error>',
            '<tool_result call="call_3" tool="fetch">got: data</tool_result>',
            '<tool_error call="call_4" tool="fetch">offline</tool_error>',
          ].join('\n'),
        );
        const done = yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        assert.deepEqual(actionTypes(done).slice(-3), [
          'tool_errored',
          'tool_result',
          'tool_errored',
        ]);
      }),
    ));

  it('submits an invalid call as a tool error the model reads', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [
          line('host', 'Watch.'),
          JSON.stringify({ type: 'shwo', call: 'call_7', label: 'x' }),
          JSON.stringify({ type: 'view', label: 3 }),
        ]);
        const next = yield* scriptNext(ctx, [line('host', 'Fixed.')]);
        yield* finishLine(ctx);
        const prompt = yield* next.prompt;
        // The model's own `call` is replaced by the handle the Harness assigned.
        assert.equal(
          prompt.at(-2)?.text,
          JSON.stringify([
            { type: 'speak', speaker: 'host', text: 'Watch.' },
            { type: 'shwo', call: 'call_1', label: 'x' },
            { type: 'view', call: 'call_2', label: 3 },
          ]),
        );
        const errors = lastUser(prompt)?.split('\n') ?? [];
        assert.equal(
          errors[0],
          '<tool_error call="call_1" tool="shwo">Unknown action type "shwo". Available types: speak, view, pick, fetch, quiet, echo, broken_command, broken_run, broken_render.</tool_error>',
        );
        assert.match(errors[1] ?? '', /^<tool_error call="call_2" tool="view">Invalid `view`: /);
        yield* playAll(ctx);
        yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('turns an unknown action type into a tool error in a speech-only session', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setupWith([]);
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [JSON.stringify({ type: 'shout', text: 'x' })]);
        const next = yield* scriptNext(ctx, [line('host', 'Sorry.')]);
        assert.equal(
          lastUser(yield* next.prompt),
          '<tool_error call="call_1" tool="shout">Unknown action type "shout". Available types: speak.</tool_error>',
        );
        yield* playAll(ctx);
        const done = yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        assert.deepEqual(actionTypes(done), ['user_message', 'tool_call', 'tool_errored', 'speak']);
      }),
    ));

  it('continues only once playback finishes, and never folds to a false idle', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('fetch', 'a'), line('host', 'While that runs.')]);
        const next = yield* scriptNext(ctx, [line('host', 'Thanks.')]);
        yield* reply(ctx, 'call_1', { reply: 'ready' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        // Still speaking: nothing is submitted mid-line.
        yield* Effect.sleep('300 millis');
        assert.equal((yield* ctx.state).pendingResults.length, 1);
        yield* finishLine(ctx);
        assert.equal(
          lastUser(yield* next.prompt),
          '<tool_result call="call_1" tool="fetch">a: ready</tool_result>',
        );
        yield* playAll(ctx);
        yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        yield* assertAgreement(subscription, ctx.state);
        const messages = yield* subscription.messages;
        assertNeverIdle(messages, 1, messages.length - 1);
        assert.equal(derivePhase(fold(messages)), 'idle');
      }),
    ));

  it('never folds to a false idle for a reply ending in a tool call or an invalid call', () =>
    run(
      Effect.gen(function* () {
        for (const final of [call('view', 'end'), JSON.stringify({ type: 'nope' })]) {
          const ctx = yield* toolSetup;
          const subscription = yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [line('host', 'Here.'), final]);
          yield* scriptNext(ctx, []);
          yield* finishLine(ctx);
          if (final.includes('view')) yield* reply(ctx, 'call_1', { reply: 'ok' });
          yield* ctx.waitFor(
            (current) => derivePhase(current) === 'idle' && current.executions.length === 0,
          );
          const messages = yield* subscription.messages;
          assertNeverIdle(messages, 1, messages.length - 1);
        }
      }),
    ));

  it('holds every outcome while a blocking tool is open', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('pick', 'q'), call('fetch', 'f')]);
        const next = yield* scriptNext(ctx, []);
        yield* reply(ctx, 'call_2', { reply: 'fast' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        yield* Effect.sleep('300 millis');
        const holding = yield* ctx.state;
        assert.equal(holding.generation, 'idle');
        assert.equal(derivePhase(holding), 'waiting');

        yield* reply(ctx, 'call_1', { reply: 'answer' });
        assert.equal(
          lastUser(yield* next.prompt),
          [
            '<tool_result call="call_2" tool="fetch">f: fast</tool_result>',
            '<tool_result call="call_1" tool="pick">q: answer</tool_result>',
          ].join('\n'),
        );
        yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('cancels a waiting blocking tool on Interrupt, keeping the other executions and held results for the next message', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('pick', 'q'), call('fetch', 'f'), call('fetch', 'g')]);
        yield* reply(ctx, 'call_2', { reply: 'fast' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        const question = yield* executionOf(ctx, 'call_1');
        assert.equal(derivePhase(yield* ctx.state), 'waiting');

        yield* ctx.command({ _tag: 'Interrupt' });
        const declined = yield* ctx.state;
        // The question is gone without an answer; the running fetch and the held result stay.
        assert.deepEqual(
          declined.executions.map((execution) => execution.handles),
          [['call_3']],
        );
        assert.equal(declined.pendingResults.length, 1);
        const interrupted = declined.actions.at(-1);
        assert.ok(interrupted?.type === 'interrupted' && interrupted.during === 'wait');
        assert.equal(derivePhase(declined), 'idle');

        // A late answer to the cancelled question is stale and changes nothing.
        const late = yield* rejection(
          ctx.command({
            _tag: 'ToolCommand',
            handle: 'call_1',
            executionId: question.executionId,
            payload: { reply: 'late' },
          }),
        );
        assert.ok(late instanceof ToolCommandRejected && late.reason === 'stale');
        assert.deepEqual(yield* ctx.state, declined);

        // Nothing continues on its own, even when another outcome arrives.
        yield* reply(ctx, 'call_3', { reply: 'slow' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 2);
        yield* Effect.sleep('300 millis');
        assert.equal((yield* ctx.state).generation, 'idle');
        assert.equal(derivePhase(yield* ctx.state), 'idle');

        const model = yield* exchange(ctx, 'Actually, stop.', []);
        assert.equal(
          lastUser(yield* model.prompt),
          [
            '<notice>The user interrupted to say something.</notice>',
            '<tool_result call="call_2" tool="fetch">f: fast</tool_result>',
            '<tool_result call="call_3" tool="fetch">g: slow</tool_result>',
            '<user_message>Actually, stop.</user_message>',
          ].join('\n'),
        );
        const after = yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        assert.equal(after.actions.filter((action) => action.type === 'user_message').length, 2);
        assert.ok(
          !after.actions.some((action) => action.type === 'tool_result' && action.tool === 'pick'),
        );
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('cancels a blocking tool on Interrupt during the narration after it: stops the line and discards the rest', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [
          line('host', 'Question.'),
          call('pick', 'q'),
          line('host', 'Take your time.'),
          line('host', 'Unplayed.'),
        ]);
        yield* finishLine(ctx);
        const playing = yield* ctx.waitFor(
          (current) => current.executions.length === 1 && current.playback !== null,
        );
        assert.equal(derivePhase(playing), 'speaking');

        // The line's playback is never acknowledged: it is held mid-line.
        yield* ctx.command({ _tag: 'Interrupt' });
        const after = yield* ctx.state;
        assert.deepEqual(actionTypes(after), [
          'user_message',
          'speak',
          'tool_call',
          'speak',
          'interrupted',
        ]);
        const interrupted = after.actions.at(-1);
        assert.ok(interrupted?.type === 'interrupted' && interrupted.during === 'speech');
        assert.deepEqual(after.executions, []);
        assert.equal(after.playback, null);
        assert.equal(derivePhase(after), 'idle');

        const model = yield* exchange(ctx, 'Wait.', [line('host', 'Okay.')]);
        assert.equal(
          lastUser(yield* model.prompt),
          '<notice>You were interrupted during your last line.</notice>\n<user_message>Wait.</user_message>',
        );
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('cancels a blocking tool on Interrupt after a generation failure, trimming the buffered lines', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${call('pick', 'q')},${line('host', 'One.')},${line('host', 'Two.')},`);
        yield* model.fail;
        const failed = yield* ctx.waitFor(
          (current) => current.generation === 'failed' && current.executions.length === 1,
        );
        assert.equal(derivePhase(failed), 'speaking');

        yield* ctx.command({ _tag: 'Interrupt' });
        const after = yield* ctx.state;
        assert.deepEqual(actionTypes(after), ['user_message', 'tool_call', 'speak', 'interrupted']);
        assert.deepEqual(after.executions, []);
        assert.equal(after.generation, 'idle');
        assert.equal(derivePhase(after), 'idle');
        yield* exchange(ctx, 'Again.', []);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('submits an answer given during narration after the last line', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [
          line('host', 'Question.'),
          call('pick', 'q'),
          line('host', 'Take your time.'),
        ]);
        const next = yield* scriptNext(ctx, []);
        yield* finishLine(ctx);
        yield* reply(ctx, 'call_1', { reply: 'early' });
        const answered = yield* ctx.waitFor((current) => current.executions.length === 0);
        assert.equal(derivePhase(answered), 'speaking');
        yield* Effect.sleep('300 millis');
        assert.equal((yield* ctx.state).generation, 'idle');
        assert.equal((yield* ctx.state).pendingResults.length, 1);
        yield* finishLine(ctx);
        assert.equal(
          lastUser(yield* next.prompt),
          '<tool_result call="call_1" tool="pick">q: early</tool_result>',
        );
      }),
    ));

  it('accepts Interrupt while working on a non-blocking tool, then holds its outcome for the next message', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('view', 'v')]);
        assert.equal(derivePhase(yield* ctx.state), 'working');
        yield* ctx.command({ _tag: 'Interrupt' });
        assert.equal(derivePhase(yield* ctx.state), 'idle');
        // Nothing was playing: the user cut into the wait.
        const interrupted = (yield* ctx.state).actions.at(-1);
        assert.ok(interrupted?.type === 'interrupted' && interrupted.during === 'wait');

        // The execution continues (ADR 0002); its late outcome waits for the user.
        yield* reply(ctx, 'call_1', { fail: 'late' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        yield* Effect.sleep('300 millis');
        const waiting = yield* ctx.state;
        assert.equal(waiting.generation, 'idle');
        assert.equal(derivePhase(waiting), 'idle');

        const model = yield* exchange(ctx, 'Next', []);
        assert.equal(
          lastUser(yield* model.prompt),
          [
            '<notice>The user interrupted to say something.</notice>',
            '<tool_error call="call_1" tool="view">late</tool_error>',
            '<user_message>Next</user_message>',
          ].join('\n'),
        );
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('submits nothing without a subscriber until one subscribes', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const first = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('fetch', 'f')]);
        yield* Fiber.interrupt(first.fiber);
        const model = yield* ctx.turn;
        yield* reply(ctx, 'call_1', { reply: 'meanwhile' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        yield* Effect.sleep('300 millis');
        assert.equal((yield* ctx.state).generation, 'idle');

        yield* subscribe(ctx.session);
        assert.equal(
          lastUser(yield* model.prompt),
          '<tool_result call="call_1" tool="fetch">f: meanwhile</tool_result>',
        );
      }),
    ));

  it('submits pending outcomes with a retry', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${call('fetch', 'f')},`);
        yield* reply(ctx, 'call_1', { reply: 'kept' });
        yield* model.fail;
        const failed = yield* ctx.waitFor((current) => current.generation === 'failed');
        assert.equal(derivePhase(failed), 'generationFailed');
        assert.equal(failed.pendingResults.length, 1);

        const retry = yield* ctx.turn;
        yield* ctx.command({ _tag: 'RetryGeneration' });
        assert.equal(
          lastUser(yield* retry.prompt),
          [
            '<notice>Your previous response was cut off after the last line. Continue from there.</notice>',
            '<tool_result call="call_1" tool="fetch">f: kept</tool_result>',
          ].join('\n'),
        );
      }),
    ));

  it('never reuses a trimmed handle', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [line('host', 'One.'), call('view', 'trimmed')]);
        yield* ctx.command({ _tag: 'Interrupt' });
        assert.deepEqual(actionTypes(yield* ctx.state), ['user_message', 'speak', 'interrupted']);
        yield* exchange(ctx, 'Again', [call('view', 'kept')]);
        const current = yield* ctx.state;
        const calls = current.actions.filter((action) => action.type === 'tool_call');
        assert.deepEqual(
          calls.map((action) => action.handle),
          ['call_2'],
        );
      }),
    ));
});

describe('Session halt', () => {
  /** Asserts the session halted with `error`, trimmed, and now rejects everything. */
  const assertHalted = (ctx: Setup, error: { tag: string; message: string }) =>
    Effect.gen(function* () {
      const halted = yield* ctx.waitFor((current) => derivePhase(current) === 'halted');
      assert.deepEqual(halted.actions.at(-1)?.type === 'tool_faulted' && halted.actions.at(-1), {
        ...(halted.actions.at(-1) as object),
        error,
      });
      assert.equal(halted.cursor, halted.actions.length);
      assert.equal(halted.generation, 'idle');
      assert.ok(!actionTypes(halted).includes('generation_failed'));
      for (const command of [
        { _tag: 'SendMessage', text: 'Hi' },
        { _tag: 'Interrupt' },
        { _tag: 'RetryGeneration' },
        { _tag: 'Back' },
      ] as const) {
        assert.deepEqual(
          yield* rejection(ctx.command(command)),
          new CommandRejected({ command: command._tag, phase: 'halted' }),
        );
      }
      assert.deepEqual(
        yield* rejection(
          ctx.command({
            _tag: 'ToolCommand',
            handle: 'call_1',
            executionId: ExecutionId.make('x'),
            payload: {},
          }),
        ),
        new CommandRejected({ command: 'ToolCommand', phase: 'halted' }),
      );
      yield* ctx.command({ _tag: 'PlaybackFinished', playbackId: PlaybackId.make('x') });
      yield* Effect.sleep('300 millis');
      assert.deepEqual(yield* ctx.state, halted);
      return halted;
    });

  it('halts on a ToolFault: trims, stops generation, and drops later outcomes', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(
          `[${call('view', 'v')},${call('fetch', 'f')},${line('host', 'One.')},${line('host', 'Two.')}`,
        );
        yield* ctx.waitFor((current) => current.actions.length === 5);
        yield* reply(ctx, 'call_1', { fault: 'disk' });
        const halted = yield* assertHalted(ctx, {
          tag: 'ToolFault',
          message: 'The view tool failed (disk).',
        });
        assert.deepEqual(actionTypes(halted), [
          'user_message',
          'tool_call',
          'tool_call',
          'speak',
          'tool_faulted',
        ]);
        const exit = yield* model.exit;
        assert.ok(exit !== undefined && Exit.hasInterrupts(exit));
        // The other execution keeps running, but commands to it are rejected and nothing it
        // produces is recorded.
        assert.equal(halted.executions.length, 1);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('halts on a defect in run', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('view', 'v')]);
        yield* reply(ctx, 'call_1', { die: true });
        yield* assertHalted(ctx, {
          tag: 'UnexpectedError',
          message: 'The view tool failed unexpectedly.',
        });
      }),
    ));

  for (const tool of ['broken_command', 'broken_run'] as const) {
    it(`halts on a throw from ${tool === 'broken_command' ? 'command(input)' : 'constructing run'}, reached during generation`, () =>
      run(
        Effect.gen(function* () {
          const ctx = yield* toolSetup;
          yield* subscribe(ctx.session);
          const model = yield* ctx.turn;
          yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
          yield* model.say(`[${call(tool, 'x')}`);
          yield* assertHalted(ctx, {
            tag: 'UnexpectedError',
            message: `The ${tool} tool failed unexpectedly.`,
          });
        }),
      ));

    it(`halts on a throw from ${tool === 'broken_command' ? 'command(input)' : 'constructing run'}, reached on PlaybackFinished`, () =>
      run(
        Effect.gen(function* () {
          const ctx = yield* toolSetup;
          yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [line('host', 'First.'), call(tool, 'x')]);
          yield* finishLine(ctx);
          yield* assertHalted(ctx, {
            tag: 'UnexpectedError',
            message: `The ${tool} tool failed unexpectedly.`,
          });
        }),
      ));
  }

  it('halts on a blocking tool that interrupts itself while the session is open', () =>
    run(
      Effect.gen(function* () {
        const quitter = fakeTool(
          'quitter',
          { blocking: true, response: 'all', replay: false },
          { run: () => Effect.interrupt },
        );
        const ctx = yield* setupWith([quitter]);
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('quitter', 'x')]);
        const halted = yield* assertHalted(ctx, {
          tag: 'UnexpectedError',
          message: 'The quitter tool failed unexpectedly.',
        });
        assert.deepEqual(halted.executions, []);
      }),
    ));

  it('halts on a defect even when the cause also holds a ToolError', () =>
    run(
      Effect.gen(function* () {
        for (const response of ['none', 'error', 'all'] as const) {
          const mixed = fakeTool(
            'mixed',
            { blocking: false, response, replay: false },
            {
              run: () =>
                Effect.failCause(
                  Cause.combine(
                    Cause.fail(new ToolError({ message: 'expected' })),
                    Cause.die('bug'),
                  ),
                ),
            },
          );
          const ctx = yield* setupWith([mixed]);
          yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [call('mixed', 'x')]);
          const halted = yield* assertHalted(ctx, {
            tag: 'UnexpectedError',
            message: 'The mixed tool failed unexpectedly.',
          });
          assert.deepEqual(halted.pendingResults, [], response);
        }
      }),
    ));

  it('halts on a ToolFault even when the cause also holds a ToolError', () =>
    run(
      Effect.gen(function* () {
        const mixed = fakeTool(
          'mixed',
          { blocking: false, response: 'error', replay: false },
          {
            run: () =>
              Effect.failCause(
                Cause.combine(
                  Cause.fail(new ToolError({ message: 'expected' })),
                  Cause.fail(new ToolFault({ reason: 'disk' })),
                ),
              ),
          },
        );
        const ctx = yield* setupWith([mixed]);
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('mixed', 'x')]);
        yield* assertHalted(ctx, { tag: 'ToolFault', message: 'The mixed tool failed (disk).' });
      }),
    ));

  it('records nothing for executions interrupted by the session scope closing', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const ctx = yield* Scope.provide(scope)(toolSetup);
        yield* Scope.provide(scope)(subscribe(ctx.session));
        yield* exchange(ctx, 'Hi', [call('pick', 'open')]);
        yield* executionOf(ctx, 'call_1');
        const before = yield* ctx.state;
        yield* Scope.close(scope, Exit.void);
        yield* Effect.sleep('50 millis');
        const after = yield* ctx.state;
        assert.deepEqual(after, before);
        assert.equal(derivePhase(after), 'waiting');
      }),
    ));

  it('halts when renderResult throws, at completion', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('broken_render', 'x')]);
        const halted = yield* assertHalted(ctx, {
          tag: 'UnexpectedError',
          message: 'The broken_render tool failed unexpectedly.',
        });
        assert.deepEqual(halted.pendingResults, []);
      }),
    ));
});

describe('Session back and replay', () => {
  it('moves only the replay position, and rejects Back with no earlier speak', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        assert.deepEqual(
          yield* rejection(ctx.command({ _tag: 'Back' })),
          new CommandRejected({ command: 'Back', phase: 'idle' }),
        );
        yield* exchange(ctx, 'Hi', [line('host', 'One.'), line('host', 'Two.')]);
        assert.deepEqual(
          yield* rejection(ctx.command({ _tag: 'Back' })),
          new CommandRejected({ command: 'Back', phase: 'speaking' }),
        );
        yield* playAll(ctx);
        const before = yield* ctx.state;

        yield* ctx.command({ _tag: 'Back' });
        const back = yield* ctx.state;
        assert.equal(back.replay, 2);
        assert.equal(back.cursor, before.cursor);
        assert.deepEqual(back.actions, before.actions);
        yield* ctx.command({ _tag: 'Back' });
        assert.equal((yield* ctx.state).replay, 1);
        const request = yield* subscription.waitFor(isPlaybackRequest);
        assert.equal(request.actionId, before.actions[1]?.id);

        yield* playAll(ctx);
        const end = yield* ctx.state;
        assert.equal(end.replay, null);
        assert.equal(derivePhase(end), 'idle');
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('holds the frontier while generation appends during a replay, then replays the cursor speak', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [line('host', 'Old.')]);
        yield* playAll(ctx);

        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'More' });
        yield* model.say(`[${line('host', 'New.')}`);
        const speaking = yield* ctx.waitFor(
          (current) => current.playback !== null && current.cursor === 3,
        );
        yield* ctx.command({ _tag: 'Back' });
        const old = (yield* ctx.state).actions[1];
        yield* model.say(`,${line('host', 'Newer.')},${call('view', 'held')}]`);
        yield* model.end;
        const appended = yield* ctx.waitFor((current) => current.generation === 'idle');
        assert.equal(appended.cursor, speaking.cursor);
        assert.equal(appended.replay, 1);
        assert.equal(appended.playback?.actionId, old?.id);
        assert.deepEqual(appended.executions, []);

        yield* finishLine(ctx);
        const resumed = yield* ctx.state;
        assert.equal(resumed.replay, null);
        assert.equal(resumed.playback?.actionId, resumed.actions[3]?.id);
        yield* playAll(ctx);
        yield* executionOf(ctx, 'call_1');
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('re-executes only replay-enabled tools under new IDs, and submits a replay failure after the replay', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [
          line('host', 'A.'),
          call('view', 'v'),
          call('fetch', 'f'),
          line('host', 'B.'),
        ]);
        yield* finishLine(ctx);
        const firstView = yield* reply(ctx, 'call_1', { reply: 'rendered' });
        yield* scriptNext(ctx, []);
        yield* reply(ctx, 'call_2', { reply: 'data' });
        yield* playAll(ctx);
        yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        yield* assertAgreement(subscription, ctx.state);
        const settled = (yield* subscription.messages).length;

        yield* ctx.command({ _tag: 'Back' });
        yield* ctx.command({ _tag: 'Back' });
        assert.equal((yield* ctx.state).replay, 1);
        yield* finishLine(ctx);
        const replayed = yield* executionOf(ctx, 'call_1');
        assert.notEqual(replayed.executionId, firstView);
        const replaying = yield* ctx.state;
        assert.equal(replaying.replay, 4);
        assert.deepEqual(
          replaying.executions.map((execution) => execution.handles[0]),
          ['call_1'],
        );

        const next = yield* scriptNext(ctx, []);
        yield* reply(ctx, 'call_1', { fail: 'no longer renders' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        yield* Effect.sleep('300 millis');
        assert.equal((yield* ctx.state).generation, 'idle');
        yield* finishLine(ctx);
        // The empty reply to the first submission left no assistant message, so both
        // submissions read as one user message.
        assert.equal(
          lastUser(yield* next.prompt),
          [
            '<tool_result call="call_2" tool="fetch">f: data</tool_result>',
            '<tool_error call="call_1" tool="view">no longer renders</tool_error>',
          ].join('\n'),
        );
        yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        const messages = yield* subscription.messages;
        assertNeverIdle(messages, settled, messages.length - 1);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('never folds to a false idle while a replayed call starts and runs', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [line('host', 'A.'), call('view', 'v')]);
        yield* finishLine(ctx);
        yield* reply(ctx, 'call_1', { reply: 'rendered' });
        yield* ctx.waitFor((current) => derivePhase(current) === 'idle');
        yield* assertAgreement(subscription, ctx.state);
        const settled = (yield* subscription.messages).length;

        yield* ctx.command({ _tag: 'Back' });
        yield* finishLine(ctx);
        yield* executionOf(ctx, 'call_1');
        assert.equal((yield* ctx.state).replay, null);
        yield* reply(ctx, 'call_1', { reply: 'rendered' });
        yield* ctx.waitFor((current) => current.executions.length === 0);
        yield* assertAgreement(subscription, ctx.state);
        const messages = yield* subscription.messages;
        assertNeverIdle(messages, settled, messages.length - 1);
        assert.equal(derivePhase(fold(messages)), 'idle');
      }),
    ));

  it('ends a replay on Interrupt, appending nothing when the conversation was idle', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [line('host', 'One.')]);
        yield* playAll(ctx);
        const idle = yield* ctx.state;
        yield* ctx.command({ _tag: 'Back' });
        assert.equal(derivePhase(yield* ctx.state), 'speaking');
        yield* ctx.command({ _tag: 'Interrupt' });
        const after = yield* ctx.state;
        assert.deepEqual(after.actions, idle.actions);
        assert.equal(after.replay, null);
        assert.equal(after.playback, null);
        assert.equal(derivePhase(after), 'idle');
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('trims an unreached call at the cursor when interrupted during a replay', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [line('host', 'One.')]);
        yield* playAll(ctx);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'More' });
        yield* ctx.command({ _tag: 'Back' });
        yield* model.say(`[${call('view', 'never')}]`);
        yield* model.end;
        const held = yield* ctx.waitFor((current) => current.generation === 'idle');
        assert.equal(currentAction(held)?.type, 'speak');
        assert.equal(held.actions[held.cursor]?.type, 'tool_call');

        yield* ctx.command({ _tag: 'Interrupt' });
        const after = yield* ctx.state;
        assert.deepEqual(actionTypes(after), [
          'user_message',
          'speak',
          'user_message',
          'interrupted',
        ]);
        assert.deepEqual(after.executions, []);
        assert.equal(derivePhase(after), 'idle');
      }),
    ));
});

/**
 * A fake pooled tool, like a worker pool: calls with the same label share one open execution, which
 * ends on a client command like `fakeTool`. It exposes each execution's `progress`, and an optional
 * context listing its busy labels.
 */
const pooledTool = (
  name: string,
  options: { readonly context?: boolean; readonly blocking?: boolean } = {},
) => {
  const busy = new Map<string, ExecutionId>();
  const progress = new Map<string, (text: string) => Effect.Effect<boolean>>();
  const base = fakeTool(name, {
    blocking: options.blocking ?? false,
    response: 'all',
    replay: false,
  });
  const tool: Tool<{ readonly label: string }, typeof Replied.Type, Reply> = {
    ...base,
    assign: (input, assignment) =>
      Effect.sync(() => {
        const open = busy.get(input.label);
        if (open !== undefined && assignment.state.executions.some((e) => e.executionId === open)) {
          return open;
        }
        busy.set(input.label, assignment.executionId);
        return assignment.executionId;
      }),
    ...(options.context === true && {
      context: Effect.sync(() =>
        busy.size === 0 ? undefined : `busy: ${[...busy.keys()].join(' ')}`,
      ),
    }),
    run: (input, context) => {
      progress.set(input.label, context.progress);
      return base
        .run(input, context)
        .pipe(Effect.ensuring(Effect.sync(() => busy.delete(input.label))));
    },
  };
  /** Offers progress from the open execution of `label`. */
  const offer = (label: string, text: string) => {
    const offerFor = progress.get(label);
    assert.ok(offerFor, `no execution of ${label} ran`);
    return offerFor(text);
  };
  return { tool, offer };
};

const emptyState: SessionState = {
  actions: [],
  cursor: 0,
  generation: 'idle',
  playback: null,
  executions: [],
  pendingResults: [],
  pendingProgress: [],
  replay: null,
  start: null,
  paused: false,
  speakers: [],
  speech: { mimeType: 'audio/ogg' },
};

describe('Session preloaded start', () => {
  const start = { message: 'M', context: { label: 'L', text: 'T' } };
  /** Records each reminder event, and reminds `R` about every listener message. */
  const recording = () => {
    const seen: Array<ReminderEvent> = [];
    const reminders = (event: ReminderEvent) => {
      seen.push(event);
      return event._tag === 'UserMessage' ? 'R' : undefined;
    };
    return { seen, reminders };
  };

  it('snapshots ready with the message and context, and an empty log', () =>
    run(
      Effect.gen(function* () {
        const { session } = yield* setupWith([], undefined, undefined, start);
        const subscription = yield* subscribe(session);
        const [snapshot] = yield* subscription.messages;
        assert.equal(snapshot?._tag, 'Snapshot');
        const { state } = snapshot;
        assert.equal(derivePhase(state), 'ready');
        assert.equal(state.start?.message.text, 'M');
        assert.equal(state.start?.context?.label, 'L');
        assert.equal(state.start?.context?.text, 'T');
        assert.deepEqual(state.actions, []);
      }),
    ));

  it('generates nothing before Start, even when subscribed', () =>
    run(
      Effect.gen(function* () {
        const { session, state, calls } = yield* setupWith([], undefined, undefined, start);
        yield* subscribe(session);
        yield* Effect.sleep('50 millis');
        assert.equal(yield* calls, 0);
        const current = yield* state;
        assert.equal(current.generation, 'idle');
        assert.equal(derivePhase(current), 'ready');
      }),
    ));

  it('rejects every other command while ready', () =>
    run(
      Effect.gen(function* () {
        const { session, state, command } = yield* setupWith([], undefined, undefined, start);
        yield* subscribe(session);
        assert.deepEqual(
          yield* rejection(command({ _tag: 'SendMessage', text: 'Hi' })),
          new CommandRejected({ command: 'SendMessage', phase: 'ready' }),
        );
        assert.deepEqual(
          yield* rejection(command({ _tag: 'Interrupt' })),
          new CommandRejected({ command: 'Interrupt', phase: 'ready' }),
        );
        assert.deepEqual(
          yield* rejection(command({ _tag: 'RetryGeneration' })),
          new CommandRejected({ command: 'RetryGeneration', phase: 'ready' }),
        );
        assert.deepEqual(
          yield* rejection(command({ _tag: 'Back' })),
          new CommandRejected({ command: 'Back', phase: 'ready' }),
        );
        assert.deepEqual(
          yield* rejection(
            command({
              _tag: 'ToolCommand',
              handle: 'call_1',
              executionId: ExecutionId.make('e'),
              payload: null,
            }),
          ),
          new ToolCommandRejected({ executionId: 'e', reason: 'stale' }),
        );
        const before = yield* state;
        yield* command({ _tag: 'PlaybackFinished', playbackId: PlaybackId.make('p') });
        assert.deepEqual(yield* state, before);
        assert.equal(derivePhase(before), 'ready');
      }),
    ));

  it('Start submits the context, then the message, and generates', () =>
    run(
      Effect.gen(function* () {
        const { seen, reminders } = recording();
        const { session, state, command, turn } = yield* setupWith([], undefined, reminders, start);
        const subscription = yield* subscribe(session);
        const pending = (yield* state).start;
        assert.ok(pending?.context);
        const model = yield* turn;

        yield* command({ _tag: 'Start' });
        const prompt = yield* model.prompt;
        assert.equal(
          prompt.findLast((message) => message.role === 'user')?.text,
          '<context label="L">T</context>\n<user_message>M</user_message>\n<reminder>R</reminder>',
        );
        yield* subscription.waitFor(
          (message): message is Extract<SubscriptionMessage, { _tag: 'StartSubmitted' }> =>
            message._tag === 'StartSubmitted',
        );
        const tags = (yield* subscription.messages).slice(1, 3).map((message) => message._tag);
        assert.deepEqual(tags, ['GenerationChanged', 'StartSubmitted']);
        const current = yield* state;
        assert.equal(current.start, null);
        assert.equal(current.generation, 'running');
        assert.equal(current.cursor, 2);
        assert.deepEqual(current.actions, [pending.context, pending.message]);
        assert.deepEqual(seen, [
          { _tag: 'UserMessage', text: 'M', interrupted: false, context: ['L'] },
        ]);
        yield* assertAgreement(subscription, state);

        yield* model.say(`[${line('host', 'Here is what I did.')}]`);
        yield* model.end;
        yield* subscription.waitFor(isPlaybackRequest);
        yield* assertAgreement(subscription, state);
      }),
    ));

  it('rejects a second Start', () =>
    run(
      Effect.gen(function* () {
        const { command, turn } = yield* setupWith([], undefined, undefined, start);
        yield* turn;
        yield* command({ _tag: 'Start' });
        assert.deepEqual(
          yield* rejection(command({ _tag: 'Start' })),
          new CommandRejected({ command: 'Start', phase: 'working' }),
        );
      }),
    ));

  it('rejects Start in a session without one', () =>
    run(
      Effect.gen(function* () {
        const { command } = yield* setup;
        assert.deepEqual(
          yield* rejection(command({ _tag: 'Start' })),
          new CommandRejected({ command: 'Start', phase: 'idle' }),
        );
      }),
    ));

  it('throws on a blank message or label', () =>
    run(
      Effect.gen(function* () {
        for (const blank of [
          { message: '  ' },
          { message: 'M', context: { label: ' ', text: 'T' } },
        ]) {
          const exit = yield* Effect.exit(setupWith([], undefined, undefined, blank));
          assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
          assert.match(
            String(Cause.squash(exit.cause)),
            /A preloaded start needs a message and a context label/,
          );
        }
      }),
    ));
});

describe('derivePhase', () => {
  const id = () => makeActionId();
  const execution = (blocking: boolean) => ({
    executionId: ExecutionId.make('e'),
    handles: ['call_1'] as const,
    tool: 'fetch',
    blocking,
    startedAt: 0,
  });
  const callAction: Action = {
    type: 'tool_call',
    id: id(),
    handle: 'call_1',
    tool: 'fetch',
    input: {},
  };
  const speak: Action = { type: 'speak', id: id(), speaker: 'host', text: 'Hi.' };
  const result = {
    type: 'tool_result',
    id: id(),
    handles: ['call_1'],
    tool: 'fetch',
    result: null,
  } as const;

  it('reads `working` whenever the system is busy and nothing plays', () => {
    const user: Action = { type: 'user_message', id: id(), text: 'Hi' };
    // Generating before the first action, and between actions.
    assert.equal(
      derivePhase({ ...emptyState, actions: [user], cursor: 1, generation: 'running' }),
      'working',
    );
    assert.equal(
      derivePhase({ ...emptyState, actions: [user, speak], cursor: 2, generation: 'running' }),
      'working',
    );
    // A presented non-blocking call.
    assert.equal(derivePhase({ ...emptyState, actions: [user, callAction], cursor: 1 }), 'working');
    // Queued results, and open executions.
    assert.equal(
      derivePhase({
        ...emptyState,
        actions: [user, callAction],
        cursor: 2,
        pendingResults: [result],
      }),
      'working',
    );
    assert.equal(
      derivePhase({
        ...emptyState,
        actions: [user, callAction],
        cursor: 2,
        executions: [execution(false)],
      }),
      'working',
    );
  });

  it('reads `waiting` only for a blocking execution', () => {
    const base = { ...emptyState, actions: [callAction], cursor: 1 };
    assert.equal(derivePhase({ ...base, executions: [execution(true)] }), 'waiting');
    assert.equal(
      derivePhase({ ...base, executions: [execution(true)], generation: 'running' }),
      'waiting',
    );
    assert.equal(derivePhase({ ...base, cursor: 0, executions: [execution(true)] }), 'waiting');
    assert.equal(derivePhase({ ...base, executions: [execution(false)] }), 'working');
  });

  it('keeps speaking, generation failure, interrupt and halt ahead of `working`', () => {
    const busy = { executions: [execution(false)], pendingResults: [result] };
    assert.equal(derivePhase({ ...emptyState, ...busy, actions: [speak], cursor: 0 }), 'speaking');
    const failed: Action = {
      type: 'generation_failed',
      id: id(),
      error: { tag: 'x', message: 'x' },
    };
    assert.equal(
      derivePhase({ ...emptyState, ...busy, actions: [failed], cursor: 1, generation: 'failed' }),
      'generationFailed',
    );
    const interrupted: Action = { type: 'interrupted', id: id(), during: 'wait' };
    assert.equal(
      derivePhase({ ...emptyState, ...busy, actions: [interrupted], cursor: 1 }),
      'idle',
    );
    const faulted: Action = {
      type: 'tool_faulted',
      id: id(),
      handles: [],
      tool: 'fetch',
      error: { tag: 'x', message: 'x' },
    };
    assert.equal(derivePhase({ ...emptyState, ...busy, actions: [faulted], cursor: 1 }), 'halted');
    assert.equal(derivePhase({ ...emptyState, actions: [speak], cursor: 1 }), 'idle');
  });

  it('is ready while a start is pending, unless halted', () => {
    const pending = {
      message: { type: 'user_message', id: id(), text: 'M' },
      context: null,
    } as const;
    assert.equal(derivePhase({ ...emptyState, start: pending }), 'ready');
    const faulted: Action = {
      type: 'tool_faulted',
      id: id(),
      handles: [],
      tool: 'fetch',
      error: { tag: 'x', message: 'x' },
    };
    assert.equal(
      derivePhase({ ...emptyState, start: pending, actions: [faulted], cursor: 1 }),
      'halted',
    );
  });
});

describe('reduce StartSubmitted', () => {
  const message: UserMessage = { type: 'user_message', id: makeActionId(), text: 'M' };
  const context: LabeledContext = { type: 'context', id: makeActionId(), label: 'L', text: 'T' };

  it('appends the context, then the message, and clears the start', () => {
    const next = reduce({ ...emptyState, start: { message, context } }, { _tag: 'StartSubmitted' });
    assert.deepEqual(next.actions, [context, message]);
    assert.equal(next.start, null);
  });

  it('appends only the message when there is no context', () => {
    const next = reduce(
      { ...emptyState, start: { message, context: null } },
      { _tag: 'StartSubmitted' },
    );
    assert.deepEqual(next.actions, [message]);
    assert.equal(next.start, null);
  });

  it('leaves a state without a start unchanged', () => {
    assert.equal(reduce(emptyState, { _tag: 'StartSubmitted' }), emptyState);
  });
});

describe('Session tool abilities', () => {
  it('assigns a call to a new execution or joins an open one; one outcome completes every held call', () =>
    run(
      Effect.gen(function* () {
        const worker = pooledTool('worker');
        const ctx = yield* setupWith([worker.tool, fetch]);
        const subscription = yield* subscribe(ctx.session);
        // The second call to `a` is reached in the same step as the first: it joins.
        yield* exchange(ctx, 'Hi', [call('worker', 'a'), call('worker', 'b'), call('worker', 'a')]);
        const started = yield* ctx.waitFor((current) => current.executions.length === 2);
        assert.deepEqual(
          started.executions.map((execution) => execution.handles),
          [['call_1', 'call_3'], ['call_2']],
        );
        const joined = yield* subscription.waitFor(
          (message): message is Extract<SubscriptionMessage, { _tag: 'ToolJoined' }> =>
            message._tag === 'ToolJoined',
        );
        assert.deepEqual(joined, {
          _tag: 'ToolJoined',
          executionId: started.executions[0]!.executionId,
          handle: 'call_3',
        });
        yield* assertAgreement(subscription, ctx.state);

        // A later call joins while `a` is still open.
        yield* ctx.command({ _tag: 'Interrupt' });
        yield* exchange(ctx, 'More', [call('worker', 'a')]);
        const more = yield* ctx.waitFor((current) => current.executions[0]?.handles.length === 3);
        assert.deepEqual(more.executions[0]?.handles, ['call_1', 'call_3', 'call_4']);
        assert.equal(more.executions.length, 2);

        // A command through any held handle reaches the execution.
        const next = yield* scriptNext(ctx, []);
        yield* reply(ctx, 'call_4', { reply: 'done' });
        yield* reply(ctx, 'call_2', { fail: 'nope' });
        const prompt = lastUser(yield* next.prompt);
        assert.equal(
          prompt,
          [
            '<tool_result calls="call_1 call_3 call_4" tool="worker">a: done</tool_result>',
            '<tool_error call="call_2" tool="worker">nope</tool_error>',
          ].join('\n'),
        );
        const results = (yield* ctx.state).actions.filter(
          (action) => action.type === 'tool_result' || action.type === 'tool_errored',
        );
        assert.deepEqual(
          results.map((action) => [action.type, 'handles' in action && action.handles]),
          [
            ['tool_result', ['call_1', 'call_3', 'call_4']],
            ['tool_errored', ['call_2']],
          ],
        );

        // Once `a` completed, a new call to it opens a new execution.
        yield* ctx.waitFor((current) => current.generation === 'idle');
        yield* exchange(ctx, 'Again', [call('worker', 'a')]);
        const again = yield* executionOf(ctx, 'call_5');
        assert.deepEqual(again.handles, ['call_5']);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('halts when `assign` dies or returns an ID that is not its own open execution', () =>
    run(
      Effect.gen(function* () {
        const cases: ReadonlyArray<
          (assignment: { readonly state: SessionState }) => Effect.Effect<ExecutionId>
        > = [
          () => Effect.die('bug in assign'),
          () => Effect.succeed(ExecutionId.make('unknown')),
          // An open execution, but of another tool.
          (assignment) => Effect.succeed(assignment.state.executions[0]!.executionId),
        ];
        for (const assign of cases) {
          const ctx = yield* setupWith([
            fakeTool('grab', { blocking: false, response: 'all', replay: false }, { assign }),
            fetch,
          ]);
          yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [call('fetch', 'f'), call('grab', 'g')]);
          const halted = yield* ctx.waitFor((current) => derivePhase(current) === 'halted');
          assert.deepEqual(halted.actions.at(-1), {
            ...(halted.actions.at(-1) as object),
            type: 'tool_faulted',
            handles: ['call_2'],
            tool: 'grab',
            error: { tag: 'UnexpectedError', message: 'The grab tool failed unexpectedly.' },
          });
        }
      }),
    ));

  it("puts the application's examples in the system prompt", () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setupWith(
          [view],
          [
            [
              { type: 'user_message', text: 'Picture it.' },
              { type: 'tool_call', tool: 'view', handle: 'call_1', input: { label: 'a' } },
            ],
          ],
        );
        const model = yield* exchange(ctx, 'Hi', [line('host', 'Hello.')]);
        const system = (yield* model.prompt)[0]?.text ?? '';
        assert.ok(
          system.endsWith(
            '## Examples (listener input, then your response)\n<user_message>Picture it.</user_message>\n[{"type":"view","label":"a"}]',
          ),
        );
      }),
    ));

  it('refuses examples that use a tool not configured', () =>
    run(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          setupWith([view], [[{ type: 'tool_call', tool: 'pick', handle: 'call_1', input: {} }]]),
        );
        assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
        assert.match(String(Cause.squash(exit.cause)), /Example 1 uses the tool "pick"/);
      }),
    ));

  it('refuses a tool that assigns calls and replays', () =>
    run(
      Effect.gen(function* () {
        const replaying = fakeTool(
          'replaying',
          { blocking: false, response: 'all', replay: true },
          { assign: (_input, assignment) => Effect.succeed(assignment.executionId) },
        );
        const exit = yield* Effect.exit(setupWith([replaying]));
        assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
        assert.match(
          String(Cause.squash(exit.cause)),
          /Tool "replaying" assigns calls, so it must not replay/,
        );
      }),
    ));

  it('uses progress while tools run and nothing else happens, starting an iteration that ends with it and the context', () =>
    run(
      Effect.gen(function* () {
        const worker = pooledTool('worker', { context: true });
        const ctx = yield* setupWith([worker.tool]);
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('worker', 'a')]);
        yield* executionOf(ctx, 'call_1');
        assert.equal(derivePhase(yield* ctx.state), 'working');

        const model = yield* ctx.turn;
        assert.equal(yield* worker.offer('a', 'Reading <files>.'), true);
        const prompt = yield* model.prompt;
        assert.equal(
          lastUser(prompt),
          [
            '<tool_progress call="call_1" tool="worker">Reading &lt;files&gt;.</tool_progress>',
            '<context tool="worker">busy: a</context>',
          ].join('\n'),
        );
        assert.deepEqual(actionTypes(yield* ctx.state).slice(-2), [
          'tool_progress',
          'tool_context',
        ]);
        // Generating: dropped.
        assert.equal(yield* worker.offer('a', 'More.'), false);
        yield* model.say('[]');
        yield* model.end;
        yield* ctx.waitFor((current) => current.generation === 'idle');
        // The progress shares the execution's handles, including joined ones.
        yield* ctx.command({ _tag: 'Interrupt' });
        yield* exchange(ctx, 'Steer', [call('worker', 'a')]);
        const again = yield* ctx.turn;
        assert.equal(yield* worker.offer('a', 'Steered.'), true);
        assert.ok(
          lastUser(yield* again.prompt)?.startsWith(
            '<tool_progress calls="call_1 call_2" tool="worker">',
          ),
        );
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('drops progress whenever anything plays, queues, generates, fails, blocks, replays or nobody listens', () =>
    run(
      Effect.gen(function* () {
        const worker = pooledTool('worker');
        const tools = [worker.tool, pick, fetch];

        // Speaking (or paused: the line is still presented).
        {
          const ctx = yield* setupWith(tools);
          yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [call('worker', 'a'), line('host', 'Meanwhile.')]);
          assert.equal(derivePhase(yield* ctx.state), 'speaking');
          assert.equal(yield* worker.offer('a', 'x'), false);
          // Once the line played, it is used.
          yield* scriptNext(ctx, []);
          yield* playAll(ctx);
          assert.equal(yield* worker.offer('a', 'x'), true);
        }
        // Results queued.
        {
          const ctx = yield* setupWith(tools);
          yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [call('worker', 'a'), call('fetch', 'f')]);
          yield* scriptNext(ctx, []);
          yield* reply(ctx, 'call_2', { reply: 'data' });
          yield* ctx.waitFor((current) => current.pendingResults.length === 1);
          assert.equal(yield* worker.offer('a', 'x'), false);
        }
        // Generation failed.
        {
          const ctx = yield* setupWith(tools);
          yield* subscribe(ctx.session);
          const model = yield* ctx.turn;
          yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
          yield* model.say(`[${call('worker', 'a')},`);
          yield* model.fail;
          yield* ctx.waitFor((current) => current.generation === 'failed');
          assert.equal(derivePhase(yield* ctx.state), 'generationFailed');
          assert.equal(yield* worker.offer('a', 'x'), false);
        }
        // A blocking execution is open.
        {
          const ctx = yield* setupWith(tools);
          yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [call('worker', 'a'), call('pick', 'q')]);
          yield* executionOf(ctx, 'call_2');
          assert.equal(yield* worker.offer('a', 'x'), false);
        }
        // Replaying an earlier line.
        {
          const ctx = yield* setupWith(tools);
          yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [line('host', 'One.'), call('worker', 'a')]);
          yield* playAll(ctx);
          yield* ctx.command({ _tag: 'Back' });
          assert.notEqual((yield* ctx.state).replay, null);
          assert.equal(yield* worker.offer('a', 'x'), false);
        }
        // Nobody subscribed.
        {
          const ctx = yield* setupWith(tools);
          yield* exchange(ctx, 'Hi', [call('worker', 'a')]);
          yield* executionOf(ctx, 'call_1');
          assert.equal(yield* worker.offer('a', 'x'), false);
        }
        // The execution closed.
        {
          const ctx = yield* setupWith(tools);
          yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [call('worker', 'a')]);
          yield* scriptNext(ctx, []);
          yield* reply(ctx, 'call_1', { reply: 'done' });
          yield* ctx.waitFor(
            (current) =>
              current.executions.length === 0 &&
              current.generation === 'idle' &&
              current.pendingResults.length === 0,
          );
          assert.equal(yield* worker.offer('a', 'x'), false);
        }
        // After an Interrupt, until the user sends.
        {
          const ctx = yield* setupWith(tools);
          yield* subscribe(ctx.session);
          yield* exchange(ctx, 'Hi', [call('worker', 'a')]);
          yield* ctx.command({ _tag: 'Interrupt' });
          assert.equal(yield* worker.offer('a', 'x'), false);
          assert.ok(!actionTypes(yield* ctx.state).includes('tool_progress'));
          yield* exchange(ctx, 'Go on', []);
          assert.equal(yield* worker.offer('a', 'x'), true);
        }
      }),
    ));

  it('records context only when it changes, and skips a failing one', () =>
    run(
      Effect.gen(function* () {
        let text: string | undefined;
        const noted = fakeTool(
          'noted',
          { blocking: false, response: 'all', replay: false },
          { context: Effect.sync(() => text) },
        );
        const failing = fakeTool(
          'failing',
          { blocking: false, response: 'all', replay: false },
          { context: Effect.die('bug in context') },
        );
        const ctx = yield* setupWith([failing, noted]);
        yield* subscribe(ctx.session);
        const contexts = Effect.map(ctx.state, (current) =>
          current.actions.flatMap((action) =>
            action.type === 'tool_context' ? [`${action.tool}:${action.text}`] : [],
          ),
        );

        yield* exchange(ctx, 'One', []);
        assert.deepEqual(yield* contexts, []);
        text = 'first';
        const second = yield* exchange(ctx, 'Two', []);
        assert.deepEqual(yield* contexts, ['noted:first']);
        assert.deepEqual(actionTypes(yield* ctx.state).slice(-2), ['user_message', 'tool_context']);
        // Replies with no lines leave the user messages in one run.
        assert.ok(
          lastUser(yield* second.prompt)?.endsWith(
            '<user_message>Two</user_message>\n<context tool="noted">first</context>',
          ),
        );
        // Unchanged: nothing recorded, but the latest context still closes the input.
        const third = yield* exchange(ctx, 'Three', []);
        assert.deepEqual(yield* contexts, ['noted:first']);
        assert.ok(
          lastUser(yield* third.prompt)?.endsWith(
            '<user_message>Two</user_message>\n<user_message>Three</user_message>\n<context tool="noted">first</context>',
          ),
        );
        text = 'second';
        yield* exchange(ctx, 'Four', []);
        text = undefined;
        const fifth = yield* exchange(ctx, 'Five', []);
        assert.deepEqual(yield* contexts, ['noted:first', 'noted:second', 'noted:']);
        assert.ok(lastUser(yield* fifth.prompt)?.endsWith('<user_message>Five</user_message>'));
        assert.ok(!lastUser(yield* fifth.prompt)?.includes('<context'));
      }),
    ));

  it('halts once on a fault outside any call, drops later ones, and halts on a defect in the stream', () =>
    run(
      Effect.gen(function* () {
        const faults = yield* Queue.unbounded<ToolFault>();
        const watcher = fakeTool(
          'watcher',
          { blocking: false, response: 'all', replay: false },
          { faults: Stream.fromQueue(faults) },
        );
        const ctx = yield* setupWith([watcher]);
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('watcher', 'w')]);
        yield* executionOf(ctx, 'call_1');
        yield* Queue.offer(faults, new ToolFault({ reason: 'crashed' }));
        const halted = yield* ctx.waitFor((current) => derivePhase(current) === 'halted');
        assert.deepEqual(halted.actions.at(-1), {
          ...(halted.actions.at(-1) as object),
          type: 'tool_faulted',
          handles: [],
          tool: 'watcher',
          error: { tag: 'ToolFault', message: 'The watcher tool failed (crashed).' },
        });
        yield* Queue.offer(faults, new ToolFault({ reason: 'again' }));
        yield* Effect.sleep('20 millis');
        assert.deepEqual((yield* ctx.state).actions, halted.actions);

        const broken = fakeTool(
          'broken',
          { blocking: false, response: 'all', replay: false },
          { faults: Stream.die('bug in faults') },
        );
        const other = yield* setupWith([broken]);
        const stopped = yield* other.waitFor((current) => derivePhase(current) === 'halted');
        assert.deepEqual(stopped.actions.at(-1), {
          ...(stopped.actions.at(-1) as object),
          type: 'tool_faulted',
          handles: [],
          tool: 'broken',
          error: { tag: 'UnexpectedError', message: 'The broken tool failed unexpectedly.' },
        });
      }),
    ));

  it('records nothing for tool faults during teardown', () =>
    run(
      Effect.gen(function* () {
        const faults = yield* Queue.unbounded<ToolFault>();
        const watcher = fakeTool(
          'watcher',
          { blocking: false, response: 'all', replay: false },
          // The stream faults as it is torn down.
          {
            faults: Stream.fromQueue(faults).pipe(
              Stream.onExit(() => Queue.offer(faults, new ToolFault({ reason: 'closing' }))),
            ),
          },
        );
        const scope = yield* Scope.make();
        const ctx = yield* Scope.provide(scope)(setupWith([watcher]));
        yield* Scope.provide(scope)(subscribe(ctx.session));
        yield* exchange(ctx, 'Hi', [call('watcher', 'w')]);
        yield* executionOf(ctx, 'call_1');
        const before = yield* ctx.state;
        yield* Scope.close(scope, Exit.void);
        yield* Queue.offer(faults, new ToolFault({ reason: 'late' }));
        yield* Effect.sleep('50 millis');
        assert.deepEqual(yield* ctx.state, before);
      }),
    ));

  it('stamps an execution with the Harness clock, and a join keeps it', () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_234_000);
        const worker = pooledTool('worker');
        const ctx = yield* setupWith([worker.tool]);
        yield* TestClock.withLive(subscribe(ctx.session));
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${call('worker', 'a')}]`);
        yield* model.end;
        const started = yield* TestClock.withLive(
          ctx.waitFor((current) => current.executions.length === 1),
        );
        assert.equal(started.executions[0]?.startedAt, 1_234_000);

        yield* TestClock.adjust('5 minutes');
        yield* ctx.command({ _tag: 'Interrupt' });
        const next = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Steer' });
        yield* next.say(`[${call('worker', 'a')}]`);
        yield* next.end;
        const joined = yield* TestClock.withLive(
          ctx.waitFor((current) => current.executions[0]?.handles.length === 2),
        );
        assert.equal(joined.executions[0]?.startedAt, 1_234_000);
      }).pipe(Effect.provide(TestClock.layer())),
    ));
});

// Pause, Play and Next

/** Wraps a fake tool so a test can offer progress from its execution of a label. */
const progressive = (base: Tool<{ readonly label: string }, typeof Replied.Type, Reply>) => {
  const progress = new Map<string, (text: string) => Effect.Effect<boolean>>();
  const tool: Tool<{ readonly label: string }, typeof Replied.Type, Reply> = {
    ...base,
    run: (input, context) => {
      progress.set(input.label, context.progress);
      return base.run(input, context);
    },
  };
  const offer = (label: string, text: string) => {
    const offerFor = progress.get(label);
    assert.ok(offerFor, `no execution of ${label} ran`);
    return offerFor(text);
  };
  return { tool, offer };
};

const countOf = (messages: ReadonlyArray<SubscriptionMessage>, tag: SubscriptionMessage['_tag']) =>
  messages.filter((message) => message._tag === tag).length;

const progressTexts = (state: SessionState) =>
  state.actions.flatMap((action) => (action.type === 'tool_progress' ? [action.text] : []));

describe('Session pause', () => {
  it('holds presentation mid-stream while generation appends, keeps the request, and resumes it on Play', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${line('host', 'One.')}`);
        const playing = yield* ctx.waitFor((current) => current.playback !== null);
        assert.ok(playing.playback);
        yield* ctx.command({ _tag: 'Pause' });
        yield* ctx.command({ _tag: 'Pause' });

        yield* model.say(`,${line('host', 'Two.')},${call('view', 'v')}]`);
        yield* model.end;
        const held = yield* ctx.waitFor((current) => current.generation === 'idle');
        assert.equal(held.paused, true);
        assert.deepEqual(actionTypes(held), ['user_message', 'speak', 'speak', 'tool_call']);
        assert.equal(held.cursor, playing.cursor);
        assert.deepEqual(held.playback, playing.playback);
        assert.deepEqual(held.executions, []);
        assert.equal(derivePhase(held), 'speaking');

        // A finish reported while paused holds the cursor and the request.
        yield* ctx.command({ _tag: 'PlaybackFinished', playbackId: playing.playback.playbackId });
        assert.equal((yield* ctx.state).cursor, playing.cursor);
        assert.deepEqual((yield* ctx.state).playback, playing.playback);

        // Play resumes the same request on this connection: nothing is requested again.
        yield* assertAgreement(subscription, ctx.state);
        const requests = countOf(yield* subscription.messages, 'PlaybackRequested');
        yield* ctx.command({ _tag: 'Play' });
        yield* ctx.command({ _tag: 'Play' });
        const resumed = yield* ctx.state;
        assert.equal(resumed.paused, false);
        assert.deepEqual(resumed.playback, playing.playback);
        yield* assertAgreement(subscription, ctx.state);
        assert.equal(countOf(yield* subscription.messages, 'PlaybackRequested'), requests);
        assert.equal(countOf(yield* subscription.messages, 'PauseChanged'), 2);

        // The finish reported after Play advances; a duplicate is harmless.
        yield* ctx.command({ _tag: 'PlaybackFinished', playbackId: playing.playback.playbackId });
        yield* ctx.command({ _tag: 'PlaybackFinished', playbackId: playing.playback.playbackId });
        const two = yield* ctx.state;
        assert.equal(two.cursor, 2);
        assert.equal(two.playback?.actionId, two.actions[2]?.id);
        yield* finishLine(ctx);
        yield* executionOf(ctx, 'call_1');
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('leaves a call appended at the paused end-of-log cursor unreached until Play', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
        yield* ctx.command({ _tag: 'Pause' });
        yield* model.say(`[${call('fetch', 'f')},${line('host', 'One.')}]`);
        yield* model.end;
        const held = yield* ctx.waitFor((current) => current.generation === 'idle');
        // The cursor names the call, but it has not executed.
        assert.equal(held.cursor, 1);
        assert.equal(held.actions[1]?.type, 'tool_call');
        assert.deepEqual(held.executions, []);
        assert.equal(held.playback, null);
        assert.equal(derivePhase(held), 'working');
        assert.equal(yield* ctx.calls, 1);

        yield* ctx.command({ _tag: 'Play' });
        const played = yield* ctx.state;
        assert.equal(played.executions.length, 1);
        assert.equal(played.cursor, 2);
        assert.equal(played.playback?.actionId, played.actions[2]?.id);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('does not let a continuation timer scheduled before Pause submit, and continues after Play', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* TestClock.withLive(subscribe(ctx.session));
        yield* TestClock.withLive(exchange(ctx, 'Hi', [call('fetch', 'f')]));
        yield* TestClock.withLive(reply(ctx, 'call_1', { reply: 'data' }));
        yield* TestClock.withLive(ctx.waitFor((current) => current.pendingResults.length === 1));
        // The timer is now sleeping on the test clock.
        yield* TestClock.withLive(Effect.sleep('20 millis'));
        yield* ctx.command({ _tag: 'Pause' });
        yield* TestClock.adjust('1 second');
        yield* TestClock.withLive(Effect.sleep('20 millis'));
        const held = yield* ctx.state;
        assert.equal(held.generation, 'idle');
        assert.equal(held.pendingResults.length, 1);
        assert.equal(yield* ctx.calls, 1);

        const next = yield* ctx.turn;
        yield* ctx.command({ _tag: 'Play' });
        yield* TestClock.adjust('1 second');
        assert.equal(
          lastUser(yield* TestClock.withLive(next.prompt)),
          '<tool_result call="call_1" tool="fetch">f: data</tool_result>',
        );
      }).pipe(Effect.provide(TestClock.layer())),
    ));

  it('accepts Play with nothing to do, and guards generation-start commands while paused', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        const before = (yield* subscription.messages).length;
        yield* ctx.command({ _tag: 'Play' });
        assert.equal((yield* subscription.messages).length, before);

        // Paused while generating: a message is rejected and the pause stands.
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
        yield* ctx.command({ _tag: 'Pause' });
        assert.deepEqual(
          yield* rejection(ctx.command({ _tag: 'SendMessage', text: 'Again' })),
          new CommandRejected({ command: 'SendMessage', phase: 'working' }),
        );
        assert.equal((yield* ctx.state).paused, true);
        // Paused at a failure: Retry is rejected until Play.
        yield* model.fail;
        yield* ctx.waitFor((current) => current.generation === 'failed');
        assert.deepEqual(
          yield* rejection(ctx.command({ _tag: 'RetryGeneration' })),
          new CommandRejected({ command: 'RetryGeneration', phase: 'generationFailed' }),
        );
        // Paused and idle-like: a message is accepted and releases the pause.
        const again = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Again' });
        assert.equal((yield* ctx.state).paused, false);
        yield* again.say('[]');
        yield* again.end;
        yield* ctx.waitFor((current) => current.generation === 'idle');
        assert.equal(yield* ctx.calls, 2);

        // Paused with nothing to do: Play only releases the pause.
        yield* ctx.command({ _tag: 'Pause' });
        yield* ctx.command({ _tag: 'Play' });
        assert.equal((yield* ctx.state).paused, false);
        assert.equal(yield* ctx.calls, 2);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('rejects Start while paused, and Play submits the preloaded start', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setupWith([], undefined, undefined, { message: 'Begin' });
        yield* subscribe(ctx.session);
        yield* ctx.command({ _tag: 'Pause' });
        assert.deepEqual(
          yield* rejection(ctx.command({ _tag: 'Start' })),
          new CommandRejected({ command: 'Start', phase: 'ready' }),
        );
        assert.equal(controls(yield* ctx.state).play, true);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'Play' });
        assert.equal(lastUser(yield* model.prompt), '<user_message>Begin</user_message>');
        assert.equal((yield* ctx.state).paused, false);
      }),
    ));

  it('rejects Pause, Play, Next and a paused send once halted, even with queued results', () =>
    run(
      Effect.gen(function* () {
        const worker = pooledTool('worker');
        const ctx = yield* setupWith([worker.tool, fetch]);
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [
          call('worker', 'a'),
          call('fetch', 'ok'),
          call('fetch', 'bad'),
        ]);
        yield* ctx.command({ _tag: 'Pause' });
        assert.equal(yield* worker.offer('a', 'Kept.'), true);
        yield* reply(ctx, 'call_2', { reply: 'fine' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        yield* reply(ctx, 'call_3', { fault: 'down' });
        const halted = yield* ctx.waitFor((current) => derivePhase(current) === 'halted');
        assert.equal(halted.paused, true);
        assert.equal(halted.pendingResults.length, 1);
        assert.deepEqual(halted.pendingProgress, []);
        assert.equal(canSend(halted), false);
        assert.equal(yield* worker.offer('a', 'Late.'), false);
        for (const command of [
          { _tag: 'Pause' },
          { _tag: 'Play' },
          { _tag: 'Next' },
          { _tag: 'SendMessage', text: 'Hi' },
        ] as const) {
          assert.deepEqual(
            yield* rejection(ctx.command(command)),
            new CommandRejected({ command: command._tag, phase: 'halted' }),
          );
        }
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('clears the request for a new subscription while paused; Play then requests afresh', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [line('host', 'One.')]);
        const first = yield* ctx.waitFor((current) => current.playback !== null);
        assert.ok(first.playback);
        yield* ctx.command({ _tag: 'Pause' });

        const second = yield* subscribe(ctx.session);
        yield* second.waitFor(
          (message): message is Extract<SubscriptionMessage, { _tag: 'PlaybackCleared' }> =>
            message._tag === 'PlaybackCleared',
        );
        yield* assertAgreement(second, ctx.state);
        assert.equal(countOf(yield* second.messages, 'PlaybackRequested'), 0);
        assert.equal((yield* ctx.state).playback, null);
        // The former connection's request no longer advances anything.
        yield* ctx.command({ _tag: 'PlaybackFinished', playbackId: first.playback.playbackId });
        assert.equal((yield* ctx.state).cursor, first.cursor);

        yield* ctx.command({ _tag: 'Play' });
        const request = yield* second.waitFor(isPlaybackRequest);
        assert.notEqual(request.playbackId, first.playback.playbackId);
        assert.equal(request.actionId, first.playback.actionId);
        yield* assertAgreement(second, ctx.state);

        // Unpaused, a new subscription replays the line under a new ID, as before.
        const third = yield* subscribe(ctx.session);
        const replayed = yield* third.waitFor(isPlaybackRequest);
        assert.notEqual(replayed.playbackId, request.playbackId);
      }),
    ));
});

describe('Session Next', () => {
  it('executes intervening tools and lands on the next speak while paused, without requesting it', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [line('host', 'One.'), call('view', 'v'), line('host', 'Two.')]);
        yield* ctx.command({ _tag: 'Pause' });
        yield* assertAgreement(subscription, ctx.state);
        const requests = countOf(yield* subscription.messages, 'PlaybackRequested');

        yield* ctx.command({ _tag: 'Next' });
        const two = yield* ctx.state;
        assert.equal(two.cursor, 3);
        assert.equal(two.playback, null);
        assert.equal(two.paused, true);
        assert.equal(two.executions.length, 1);
        yield* assertAgreement(subscription, ctx.state);
        assert.equal(countOf(yield* subscription.messages, 'PlaybackRequested'), requests);

        // The final speak can be skipped; then nothing is left to process.
        yield* ctx.command({ _tag: 'Next' });
        assert.equal((yield* ctx.state).cursor, 4);
        assert.equal((yield* rejection(ctx.command({ _tag: 'Next' })))._tag, 'CommandRejected');
        assert.equal((yield* ctx.state).cursor, 4);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('processes an unreached call at the cursor rather than skipping it', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
        yield* ctx.command({ _tag: 'Pause' });
        yield* model.say(`[${call('fetch', 'f')},${line('host', 'One.')}]`);
        yield* model.end;
        yield* ctx.waitFor((current) => current.generation === 'idle');
        yield* ctx.command({ _tag: 'Next' });
        const next = yield* ctx.state;
        assert.equal(next.executions.length, 1);
        assert.deepEqual(next.executions[0]?.handles, ['call_1']);
        assert.equal(next.cursor, 2);
        assert.equal(next.playback, null);
      }),
    ));

  it('skips the presented speak when unpaused, like a finished playback; the old request is stale', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [line('host', 'One.'), line('host', 'Two.')]);
        const one = yield* ctx.waitFor((current) => current.playback !== null);
        assert.ok(one.playback);
        yield* ctx.command({ _tag: 'Next' });
        const two = yield* ctx.state;
        assert.equal(two.cursor, 2);
        assert.equal(two.playback?.actionId, two.actions[2]?.id);
        yield* ctx.command({ _tag: 'PlaybackFinished', playbackId: one.playback.playbackId });
        assert.equal((yield* ctx.state).cursor, 2);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('replays only replay-enabled tools while paused, and never reruns replay-disabled work', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [
          line('host', 'One.'),
          call('view', 'v'),
          call('fetch', 'f'),
          line('host', 'Two.'),
        ]);
        yield* playAll(ctx);
        const executed = (yield* ctx.state).executions.map((execution) => execution.tool);
        assert.deepEqual(executed, ['view', 'fetch']);
        yield* ctx.command({ _tag: 'Back' });
        yield* ctx.command({ _tag: 'Back' });
        yield* ctx.command({ _tag: 'Pause' });
        assert.equal((yield* ctx.state).replay, 1);

        yield* ctx.command({ _tag: 'Next' });
        const two = yield* ctx.state;
        assert.equal(two.replay, 4);
        assert.equal(two.playback, null);
        assert.deepEqual(
          two.executions.map((execution) => execution.tool),
          ['view', 'fetch', 'view'],
        );
        yield* ctx.command({ _tag: 'Next' });
        const end = yield* ctx.state;
        assert.equal(end.replay, null);
        assert.equal(end.executions.length, 3);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('rejoins the frontier after a paused replay by reaching a call buffered at the cursor', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [line('host', 'Old.')]);
        yield* playAll(ctx);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'More' });
        yield* ctx.command({ _tag: 'Back' });
        yield* ctx.command({ _tag: 'Pause' });
        yield* model.say(`[${call('fetch', 'f')}]`);
        yield* model.end;
        const held = yield* ctx.waitFor((current) => current.generation === 'idle');
        assert.equal(held.replay, 1);
        assert.equal(held.actions[held.cursor]?.type, 'tool_call');
        assert.deepEqual(held.executions, []);

        yield* ctx.command({ _tag: 'Next' });
        const rejoined = yield* ctx.state;
        assert.equal(rejoined.replay, null);
        assert.equal(rejoined.cursor, rejoined.actions.length);
        assert.deepEqual(rejoined.executions[0]?.handles, ['call_1']);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('rejects Next with nothing to process', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* toolSetup;
        yield* subscribe(ctx.session);
        assert.deepEqual(
          yield* rejection(ctx.command({ _tag: 'Next' })),
          new CommandRejected({ command: 'Next', phase: 'idle' }),
        );
      }),
    ));
});

describe('Session queued progress', () => {
  it('keeps the latest progress while paused, even unsubscribed, and submits it once after Play', () =>
    run(
      Effect.gen(function* () {
        const worker = pooledTool('worker');
        const ctx = yield* setupWith([worker.tool]);
        const first = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('worker', 'a')]);
        yield* ctx.command({ _tag: 'Pause' });
        assert.equal(yield* worker.offer('a', 'One.'), true);
        yield* Fiber.interrupt(first.fiber);
        assert.equal(yield* worker.offer('a', 'Two.'), true);
        const held = yield* ctx.state;
        assert.deepEqual(
          held.pendingProgress.map((progress) => progress.text),
          ['Two.'],
        );
        assert.equal(held.generation, 'idle');
        assert.equal(yield* ctx.calls, 1);

        const subscription = yield* subscribe(ctx.session);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'Play' });
        assert.equal(
          lastUser(yield* model.prompt),
          '<tool_progress call="call_1" tool="worker">Two.</tool_progress>',
        );
        const submitted = yield* ctx.state;
        assert.deepEqual(progressTexts(submitted), ['Two.']);
        assert.deepEqual(submitted.pendingProgress, []);
        assert.equal(yield* ctx.calls, 2);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('keeps separate executions apart, submits in start order, with handles joined after the offer', () =>
    run(
      Effect.gen(function* () {
        const worker = pooledTool('worker');
        const ctx = yield* setupWith([worker.tool]);
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('worker', 'a'), call('worker', 'b')]);
        yield* ctx.command({ _tag: 'Interrupt' });
        const steer = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Steer' });
        yield* ctx.command({ _tag: 'Pause' });
        yield* steer.say(`[${call('worker', 'a')}]`);
        yield* steer.end;
        yield* ctx.waitFor((current) => current.generation === 'idle');
        assert.equal(yield* worker.offer('b', 'B.'), true);
        assert.equal(yield* worker.offer('a', 'A.'), true);
        assert.equal((yield* ctx.state).pendingProgress.length, 2);

        // Reaching the buffered call joins it to a's execution.
        yield* ctx.command({ _tag: 'Next' });
        assert.deepEqual((yield* ctx.state).executions[0]?.handles, ['call_1', 'call_3']);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'Play' });
        assert.equal(
          lastUser(yield* model.prompt),
          [
            '<tool_progress calls="call_1 call_3" tool="worker">A.</tool_progress>',
            '<tool_progress call="call_2" tool="worker">B.</tool_progress>',
          ].join('\n'),
        );
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('replaces progress with its final result, and reminders see the result once at submission', () =>
    run(
      Effect.gen(function* () {
        const events: Array<ReminderEvent> = [];
        const fetching = progressive(fetch);
        const worker = pooledTool('worker');
        const ctx = yield* setupWith([fetching.tool, worker.tool], undefined, (event) => {
          events.push(event);
          return undefined;
        });
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('fetch', 'f'), call('worker', 'a')]);
        const before = events.length;
        yield* ctx.command({ _tag: 'Pause' });
        assert.equal(yield* fetching.offer('f', 'Fetching.'), true);
        assert.equal(yield* worker.offer('a', 'Working.'), true);
        yield* reply(ctx, 'call_1', { reply: 'data' });
        const held = yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        assert.deepEqual(
          held.pendingProgress.map((progress) => progress.text),
          ['Working.'],
        );
        assert.equal(events.length, before);

        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'Play' });
        assert.equal(
          lastUser(yield* model.prompt),
          [
            '<tool_result call="call_1" tool="fetch">f: data</tool_result>',
            '<tool_progress call="call_2" tool="worker">Working.</tool_progress>',
          ].join('\n'),
        );
        assert.deepEqual(progressTexts(yield* ctx.state), ['Working.']);
        assert.deepEqual(
          events.slice(before).map((event) => event._tag),
          ['ToolResult'],
        );
        // Ordering: running, then one submission of results and progress.
        yield* assertAgreement(subscription, ctx.state);
        const messages = yield* subscription.messages;
        const running = messages.findLastIndex(
          (message) => message._tag === 'GenerationChanged' && message.generation === 'running',
        );
        assert.equal(messages[running + 1]?._tag, 'ResultsSubmitted');
        assert.equal(countOf(messages, 'ResultsSubmitted'), 1);
      }),
    ));

  it('drops kept progress on a response-free completion and on a cancelled question, and rejects late offers', () =>
    run(
      Effect.gen(function* () {
        const silent = progressive(quiet);
        const asking = progressive(pick);
        const ctx = yield* setupWith([silent.tool, asking.tool]);
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('quiet', 'q'), call('pick', 'p')]);
        yield* ctx.command({ _tag: 'Pause' });
        assert.equal(yield* silent.offer('q', 'Quiet.'), true);
        assert.equal(yield* asking.offer('p', 'Asking.'), true);
        yield* reply(ctx, 'call_1', { reply: 'x' });
        const quieted = yield* ctx.waitFor((current) => current.executions.length === 1);
        assert.deepEqual(
          quieted.pendingProgress.map((progress) => progress.text),
          ['Asking.'],
        );
        assert.equal(yield* silent.offer('q', 'Late.'), false);

        yield* ctx.command({ _tag: 'Interrupt' });
        const declined = yield* ctx.state;
        assert.equal(declined.paused, true);
        assert.deepEqual(declined.executions, []);
        assert.deepEqual(declined.pendingProgress, []);
        assert.equal(yield* asking.offer('p', 'Late.'), false);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('replaces kept progress while resumed but busy, drops progress without a kept one, and submits the newest', () =>
    run(
      Effect.gen(function* () {
        const worker = pooledTool('worker');
        const ctx = yield* setupWith([worker.tool]);
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [
          call('worker', 'a'),
          call('worker', 'b'),
          line('host', 'One.'),
        ]);
        yield* ctx.command({ _tag: 'Pause' });
        assert.equal(yield* worker.offer('a', 'A1.'), true);
        yield* ctx.command({ _tag: 'Play' });
        assert.equal(derivePhase(yield* ctx.state), 'speaking');
        assert.equal(yield* worker.offer('a', 'A2.'), true);
        assert.equal(yield* worker.offer('b', 'B.'), false);
        assert.deepEqual(
          (yield* ctx.state).pendingProgress.map((progress) => progress.text),
          ['A2.'],
        );

        const model = yield* ctx.turn;
        yield* finishLine(ctx);
        assert.equal(
          lastUser(yield* model.prompt),
          '<tool_progress call="call_1" tool="worker">A2.</tool_progress>',
        );
        assert.deepEqual(progressTexts(yield* ctx.state), ['A2.']);
        assert.equal(yield* ctx.calls, 2);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('submits queued results and progress before a message sent after Interrupt, starting one iteration', () =>
    run(
      Effect.gen(function* () {
        const worker = pooledTool('worker');
        const ctx = yield* setupWith([worker.tool, fetch]);
        const subscription = yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('worker', 'a'), call('fetch', 'f')]);
        yield* ctx.command({ _tag: 'Pause' });
        yield* reply(ctx, 'call_2', { reply: 'data' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        assert.equal(yield* worker.offer('a', 'Working.'), true);
        yield* ctx.command({ _tag: 'Interrupt' });
        assert.equal((yield* ctx.state).paused, true);
        assert.equal(yield* ctx.calls, 1);

        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Go on' });
        assert.equal((yield* ctx.state).paused, false);
        const prompt = lastUser(yield* model.prompt) ?? '';
        const result = prompt.indexOf('<tool_result');
        const progress = prompt.indexOf('<tool_progress');
        const message = prompt.indexOf('Go on');
        assert.ok(result >= 0 && result < progress && progress < message, prompt);
        assert.equal(yield* ctx.calls, 2);
        yield* assertAgreement(subscription, ctx.state);
      }),
    ));

  it('accepts a paused send when only queued results remain, but not while work runs', () =>
    run(
      Effect.gen(function* () {
        const ctx = yield* setupWith([fetch]);
        yield* subscribe(ctx.session);
        yield* exchange(ctx, 'Hi', [call('fetch', 'f'), call('fetch', 'g')]);
        yield* ctx.command({ _tag: 'Pause' });
        yield* reply(ctx, 'call_1', { reply: 'one' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        assert.deepEqual(
          yield* rejection(ctx.command({ _tag: 'SendMessage', text: 'Early' })),
          new CommandRejected({ command: 'SendMessage', phase: 'working' }),
        );
        assert.equal((yield* ctx.state).paused, true);
        yield* reply(ctx, 'call_2', { reply: 'two' });
        const settled = yield* ctx.waitFor((current) => current.pendingResults.length === 2);
        assert.equal(derivePhase(settled), 'working');
        assert.equal(controls(settled).send, true);

        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Now' });
        assert.equal(
          lastUser(yield* model.prompt),
          [
            '<tool_result call="call_1" tool="fetch">f: one</tool_result>',
            '<tool_result call="call_2" tool="fetch">g: two</tool_result>',
            '<user_message>Now</user_message>',
          ].join('\n'),
        );
      }),
    ));

  it('holds queued input at a paused failure; Play starts nothing and Retry submits it', () =>
    run(
      Effect.gen(function* () {
        const worker = pooledTool('worker');
        const ctx = yield* setupWith([worker.tool, fetch]);
        yield* subscribe(ctx.session);
        const model = yield* ctx.turn;
        yield* ctx.command({ _tag: 'SendMessage', text: 'Hi' });
        yield* model.say(`[${call('worker', 'a')},${call('fetch', 'f')},`);
        yield* model.fail;
        yield* ctx.waitFor((current) => current.generation === 'failed');
        yield* ctx.command({ _tag: 'Pause' });
        yield* reply(ctx, 'call_2', { reply: 'data' });
        yield* ctx.waitFor((current) => current.pendingResults.length === 1);
        assert.equal(yield* worker.offer('a', 'Working.'), true);

        yield* ctx.command({ _tag: 'Play' });
        const played = yield* ctx.state;
        assert.equal(played.generation, 'failed');
        assert.equal(played.pendingProgress.length, 1);
        assert.equal(yield* ctx.calls, 1);

        const retry = yield* ctx.turn;
        yield* ctx.command({ _tag: 'RetryGeneration' });
        assert.equal(
          lastUser(yield* retry.prompt),
          [
            '<notice>Your previous response was cut off after the last line. Continue from there.</notice>',
            '<tool_result call="call_2" tool="fetch">f: data</tool_result>',
            '<tool_progress call="call_1" tool="worker">Working.</tool_progress>',
          ].join('\n'),
        );
      }),
    ));
});

describe('controls', () => {
  const speak: Action = { type: 'speak', id: makeActionId(), speaker: 'host', text: 'Hi.' };
  const result = {
    type: 'tool_result',
    id: makeActionId(),
    handles: ['call_1'],
    tool: 'fetch',
    result: null,
  } as const;
  const faulted: Action = {
    type: 'tool_faulted',
    id: makeActionId(),
    handles: [],
    tool: 'fetch',
    error: { tag: 'UnexpectedError', message: 'x' },
  };

  it('offers Play only to release a pause or start, and Pause only when unpaused', () => {
    assert.deepEqual(controls(emptyState), {
      back: false,
      next: false,
      play: false,
      pause: true,
      send: true,
    });
    assert.equal(controls({ ...emptyState, paused: true }).play, true);
    assert.equal(controls({ ...emptyState, paused: true }).pause, false);
    const halted = { ...emptyState, actions: [faulted], cursor: 1, paused: true };
    assert.deepEqual(controls(halted), {
      back: false,
      next: false,
      play: false,
      pause: false,
      send: false,
    });
  });

  it('offers Next while replaying or before the end, and Back with an earlier speak', () => {
    const onSpeak = { ...emptyState, actions: [speak], cursor: 0 };
    assert.equal(controls(onSpeak).next, true);
    assert.equal(controls(onSpeak).back, false);
    const replaying = { ...emptyState, actions: [speak, speak], cursor: 2, replay: 1 };
    assert.equal(controls(replaying).next, true);
    assert.equal(controls(replaying).back, true);
  });

  it('accepts a send while paused with only queued results, never once halted', () => {
    const queued = { ...emptyState, actions: [speak], cursor: 1, pendingResults: [result] };
    assert.equal(derivePhase(queued), 'working');
    assert.equal(canSend(queued), false);
    assert.equal(canSend({ ...queued, paused: true }), true);
    assert.equal(canSend({ ...queued, paused: true, actions: [speak, faulted], cursor: 2 }), false);
  });

  it('reads the frontier phase beneath a replay', () => {
    const failed: Action = {
      type: 'generation_failed',
      id: makeActionId(),
      error: { tag: 'ProviderError', message: 'x' },
    };
    const replaying = {
      ...emptyState,
      actions: [speak, failed],
      cursor: 2,
      replay: 0,
      generation: 'failed' as const,
    };
    assert.equal(derivePhase(replaying), 'speaking');
    assert.equal(frontierPhase(replaying), 'generationFailed');
  });
});
