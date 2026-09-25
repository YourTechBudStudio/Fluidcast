import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Cause, Effect, Exit, Fiber, Layer, Queue, Ref, Stream, type Scope } from 'effect';
import { LanguageModel, type Prompt, type Response } from 'effect/unstable/ai';

import type { Action, Speak } from '@yourtechbudstudio/fluidcast-core/actions';
import {
  SpeechSynthesizer,
  type SpeechError,
  type SynthesizeRequest,
} from '@yourtechbudstudio/fluidcast-core/speech';

import type { SessionConfig } from './config.ts';
import {
  CommandRejected,
  derivePhase,
  PlaybackId,
  reduce,
  SpeechNotFound,
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
  const model = yield* LanguageModel.make({
    generateText: () => Effect.die('unused'),
    streamText: (options) =>
      Stream.unwrap(
        Effect.gen(function* () {
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
  return { model, turn };
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
const eventually = <A>(effect: Effect.Effect<A>, done: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const value = yield* effect;
      if (done(value)) return value;
      yield* Effect.sleep('1 millis');
    }
    return yield* Effect.die('condition not reached within a second');
  });

/** Builds a session with a scripted model, plus helpers. */
const setup = Effect.gen(function* () {
  const { model, turn } = yield* scriptedModel;
  const { service, state } = yield* make(config).pipe(
    Effect.provide(
      Layer.merge(
        Layer.succeed(LanguageModel.LanguageModel, model),
        Layer.succeed(SpeechSynthesizer, fakeSynthesizer),
      ),
    ),
  );
  const command = (next: Command) => service.command(next);
  const waitFor = (done: (state: SessionState) => boolean) => eventually(state, done);
  return { session: service, state, command, waitFor, turn };
});

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
        yield* waitFor((current) => derivePhase(current) === 'waiting');
        assert.deepEqual(
          yield* rejection(command({ _tag: 'SendMessage', text: 'Again' })),
          new CommandRejected({ command: 'SendMessage', phase: 'waiting' }),
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
        assert.equal(derivePhase(yield* state), 'waiting');
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
