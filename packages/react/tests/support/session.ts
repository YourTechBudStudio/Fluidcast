import { Context, Deferred, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { LanguageModel } from 'effect/ai';

import { Transport, TransportError } from '@yourtechbudstudio/fluidcast-client';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { layer as sessionLayer, Session } from '@yourtechbudstudio/fluidcast-harness';
import type { Command, SubscriptionMessage } from '@yourtechbudstudio/fluidcast-harness/protocol';
import type { Skill } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import { askTool } from '@yourtechbudstudio/fluidcast-tool-ask';
import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';

import { type FluidcastPlayerProps, WorkerFeed } from '../../src/index';

/**
 * A real Harness session behind an in-memory host connection, for driving `FluidcastPlayer` in a DOM. The model is
 * scripted, the Show and Ask tools are the real ones, and speech is the text's bytes. Everything the connection carries
 * is recorded, and the transport can fail or hold chosen commands, or hold its own construction, so tests can open
 * the windows real networks open.
 */

/** One scripted model action, as the model would write it. */
export type ScriptedAction = Readonly<Record<string, unknown>>;

export const speak = (text: string): ScriptedAction => ({ type: 'speak', speaker: 'host', text });
export const showMarkdown = (content: string): ScriptedAction => ({
  type: 'show',
  format: 'markdown',
  content,
});
export const askChoice = (question: string, labels: readonly string[]): ScriptedAction => ({
  type: 'ask',
  kind: 'choice',
  question,
  options: labels.map((label) => ({ label })),
});

type CommandTag = Command['_tag'];

/** A control that releases something the fixture holds. */
export interface Hold {
  readonly release: () => void;
}

export interface ScriptedSession {
  /** A fresh connection Layer over this session: a new identity on every call. */
  readonly connection: () => FluidcastPlayerProps['connection'];
  /** Every command the player sent, in order, including failed and held ones. */
  readonly commands: ReadonlyArray<Command>;
  /** Tags of `commands`, for short assertions. */
  readonly tags: () => ReadonlyArray<CommandTag>;
  /** Every subscription message relayed to the player, with the subscription (1, 2, …) that carried it. */
  readonly relayed: ReadonlyArray<{
    readonly subscription: number;
    readonly message: SubscriptionMessage;
  }>;
  readonly openSubscriptions: () => number;
  /** Open `WorkerFeed` runs (status and transcript connections). */
  readonly openWorkerFeeds: () => number;
  /** How many times the player read the worker's skills. */
  readonly skillReads: () => number;
  /** Sends a command straight to the session, without a player: prepares state. */
  readonly drive: (command: Command) => Promise<void>;
  /** Makes `send` fail with `error` for commands tagged `tag`, until cleared with `failSend(tag, null)`. */
  readonly failSend: (tag: CommandTag, error: TransportError | null) => void;
  /** Holds every `send` of `tag` unresolved (recorded, not yet applied) until released. */
  readonly holdSend: (tag: CommandTag) => Hold;
  /** Holds the construction of connections built from now on, so the player's runtime stays unbuilt until released. */
  readonly holdConstruction: () => Hold;
  /** Holds the model's next replies until released, so a turn stays generating. */
  readonly holdModel: () => Hold;
  readonly close: () => Promise<void>;
}

const synthesizer = SpeechSynthesizer.of({
  synthesize: (request) => Stream.make(new TextEncoder().encode(request.text)),
});

/**
 * A model that answers its n-th generation with `replies[n]`, repeating the last one. While `held()` returns a
 * Deferred, a reply waits for it.
 */
const scriptedModel = (
  replies: ReadonlyArray<ReadonlyArray<ScriptedAction>>,
  held: () => Deferred.Deferred<void> | null,
) => {
  let calls = 0;
  return LanguageModel.make({
    generateText: () => Effect.die('unused'),
    streamText: () => {
      const reply = replies[Math.min(calls++, replies.length - 1)] ?? [];
      const wait = held();
      const text = Stream.make({
        type: 'text-delta',
        id: 't',
        delta: JSON.stringify(reply),
      } as const);
      return wait === null ? text : Stream.unwrap(Effect.as(Deferred.await(wait), text));
    },
  });
};

/** A held Deferred and its release. */
const hold = (onRelease: (deferred: Deferred.Deferred<void>) => void) => {
  const deferred = Deferred.makeUnsafe<void>();
  return {
    deferred,
    release: () => {
      onRelease(deferred);
      Deferred.doneUnsafe(deferred, Effect.void);
    },
  };
};

export async function scriptedSession(
  replies: ReadonlyArray<ReadonlyArray<ScriptedAction>>,
  options: {
    readonly start?: Parameters<typeof sessionLayer>[0]['start'];
    /** The worker's skills, or the failure reading them gives. None by default. */
    readonly skills?: ReadonlyArray<Skill> | TransportError;
  } = {},
): Promise<ScriptedSession> {
  const scope = await Effect.runPromise(Scope.make());
  let modelHold: Deferred.Deferred<void> | null = null;
  const harness = sessionLayer({
    instructions: 'Be brief.',
    speakers: [{ id: 'host', name: 'Host', personality: 'Warm.', voice: { name: 'alloy' } }],
    speechFormat: 'opus',
    tools: [showTool(), askTool()],
    ...(options.start === undefined ? {} : { start: options.start }),
  }).pipe(
    Layer.provide(
      Layer.merge(
        Layer.effect(
          LanguageModel.LanguageModel,
          scriptedModel(replies, () => modelHold),
        ),
        Layer.succeed(SpeechSynthesizer, synthesizer),
      ),
    ),
  );
  const context = await Effect.runPromise(Layer.buildWithScope(harness, scope));
  const session = Context.get(context, Session);

  const commands: Array<Command> = [];
  const relayed: Array<{ subscription: number; message: SubscriptionMessage }> = [];
  const failures = new Map<CommandTag, TransportError>();
  const sendHolds = new Map<CommandTag, Deferred.Deferred<void>>();
  let subscriptions = 0;
  let openSubscriptions = 0;
  let openWorkerFeeds = 0;
  let skillReads = 0;
  let constructionHold: Deferred.Deferred<void> | null = null;

  const transport = Transport.of({
    subscribe: () =>
      Stream.unwrap(
        Effect.sync(() => {
          const subscription = ++subscriptions;
          openSubscriptions++;
          return session.subscribe().pipe(
            Stream.tap((message) =>
              Effect.sync(() => void relayed.push({ subscription, message })),
            ),
            Stream.ensuring(Effect.sync(() => void openSubscriptions--)),
          );
        }),
      ),
    send: (command) =>
      Effect.gen(function* () {
        commands.push(command);
        const failure = failures.get(command._tag);
        if (failure) return yield* Effect.fail(failure);
        const held = sendHolds.get(command._tag);
        if (held) yield* Deferred.await(held);
        return yield* session.command(command);
      }),
    speech: (actionId) => session.speech(actionId),
  });

  /** A Worker connection that stays open until the player drops it, counting while it is. */
  const feedRun = <A>(): Stream.Stream<A, TransportError> =>
    Stream.unwrap(
      Effect.sync(() => {
        openWorkerFeeds++;
        return Stream.never.pipe(Stream.ensuring(Effect.sync(() => void openWorkerFeeds--)));
      }),
    );
  const skills = options.skills ?? [];
  const workerFeed = WorkerFeed.of({
    status: feedRun,
    transcript: feedRun,
    skills: () =>
      Effect.suspend(() => {
        skillReads++;
        return skills instanceof TransportError ? Effect.fail(skills) : Effect.succeed(skills);
      }),
  });

  return {
    connection: () => {
      const held = constructionHold;
      const services = Layer.mergeAll(
        Layer.succeed(Transport, transport),
        Layer.succeed(WorkerFeed, workerFeed),
      );
      return held === null ? services : Layer.unwrap(Effect.as(Deferred.await(held), services));
    },
    commands,
    tags: () => commands.map((command) => command._tag),
    relayed,
    openSubscriptions: () => openSubscriptions,
    openWorkerFeeds: () => openWorkerFeeds,
    skillReads: () => skillReads,
    drive: (command) => Effect.runPromise(session.command(command)),
    failSend: (tag, error) => {
      if (error === null) failures.delete(tag);
      else failures.set(tag, error);
    },
    holdSend: (tag) => {
      const held = hold((deferred) => {
        if (sendHolds.get(tag) === deferred) sendHolds.delete(tag);
      });
      sendHolds.set(tag, held.deferred);
      return { release: held.release };
    },
    holdConstruction: () => {
      const held = hold((deferred) => {
        if (constructionHold === deferred) constructionHold = null;
      });
      constructionHold = held.deferred;
      return { release: held.release };
    },
    holdModel: () => {
      const held = hold((deferred) => {
        if (modelHold === deferred) modelHold = null;
      });
      modelHold = held.deferred;
      return { release: held.release };
    },
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

export { TransportError };
