/** The adapter contract between the SDK-neutral Forward tool and one kind of worker (an agent SDK). */
import { Cause, Effect, Schema, type Stream } from 'effect';

import type { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import { SkillsUnavailable, type Modifier, type Skill, type TranscriptEntry } from './schema.ts';

/** One message for the worker. `id` is a UUID the worker reports back in `Consumed`. */
export interface WorkerMessage {
  readonly id: string;
  readonly text: string;
}

/** What a worker reports while its connection runs. */
export type WorkerEvent =
  /** A normalised transcript item. A turn's end is a `turnEnd` entry. */
  | { readonly _tag: 'Entry'; readonly entry: TranscriptEntry }
  /** Messages a turn has taken in. */
  | { readonly _tag: 'Consumed'; readonly ids: ReadonlyArray<string> }
  /** Idle, with no live background work, and a turn's result seen. */
  | { readonly _tag: 'Settled' }
  /**
   * How many background tasks (agents or shell commands) are live now, whenever that changes.
   * Neither activity nor the transcript. A worker type that cannot tell never sends it.
   */
  | { readonly _tag: 'BackgroundTasks'; readonly count: number }
  /**
   * The agent's ID for a new session, once, before or with the connection's first entry. The agent
   * owns the ID: a new worker has none until this arrives. Optional on resume, where it must equal
   * the resumed ID.
   */
  | { readonly _tag: 'SessionStarted'; readonly sessionId: string };

/** One kind of worker, such as Claude Code. */
export interface WorkerType {
  /** Where a new worker runs. */
  readonly cwd: string;
  /**
   * The exact message text for a prompt and the hook's modifiers, in this worker type's syntax.
   * Throws when the type cannot express the modifiers (a hook defect, which halts).
   */
  readonly composeMessage: (prompt: string, modifiers: ReadonlyArray<Modifier>) => string;
  /** Preload: checks an existing session and reads its directory and history. Starts no turn. */
  readonly attach: (
    sessionId: string,
  ) => Effect.Effect<
    { readonly cwd: string; readonly history: ReadonlyArray<TranscriptEntry> },
    WorkerSetupError
  >;
  /**
   * Runs one worker process for as long as the stream is consumed: it reads `input`, and its
   * finalizer closes the process. An end or failure of the process fails the stream with a
   * `ToolFault`; interruption is teardown and records nothing. `resume` is the session to continue,
   * or `undefined` for a new session, whose ID the agent reports with `SessionStarted`.
   */
  readonly connect: (
    worker: { readonly cwd: string; readonly resume: string | undefined },
    input: Stream.Stream<WorkerMessage>,
  ) => Stream.Stream<WorkerEvent, ToolFault>;
  /**
   * The skills a worker in `cwd` can be sent as modifiers, including those its model never invokes
   * on its own. Starts no turn. Fails with `SkillsUnavailable` when they cannot be listed in time.
   */
  readonly listSkills: (cwd: string) => Effect.Effect<ReadonlyArray<Skill>, SkillsUnavailable>;
}

/** The worker could not be set up: the session to preload cannot be attached. */
export class WorkerSetupError extends Schema.TaggedError<WorkerSetupError>()('WorkerSetupError', {
  sessionId: Schema.String,
  reason: Schema.Literals(['SessionNotFound', 'SessionUnreadable']),
}) {}

/** How long a worker type may take to list its skills. */
const listSkillsTimeout = '10 seconds';

/**
 * A worker type's skill listing, bounded by its timeout (interrupting it, so its finalizers close
 * what it opened): any failure is logged by `log`, which must not log payloads, then becomes
 * `SkillsUnavailable`.
 */
export const boundedListing = <A, E>(
  listing: Effect.Effect<A, E>,
  log: (error: E | Cause.TimeoutError) => Effect.Effect<void>,
): Effect.Effect<A, SkillsUnavailable> =>
  listing.pipe(
    Effect.timeout(listSkillsTimeout),
    Effect.tapError(log),
    Effect.mapError(
      (error) =>
        new SkillsUnavailable({ reason: Cause.isTimeoutError(error) ? 'TimedOut' : 'Failed' }),
    ),
  );
