/** The adapter contract between the SDK-neutral Forward tool and one kind of worker (an agent SDK). */
import { Schema, type Effect, type Stream } from 'effect';

import type { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import type { Modifier } from './handoff.ts';
import type { TranscriptEntry } from './schema.ts';

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
  | { readonly _tag: 'Settled' };

/** One kind of worker, such as Claude Code. */
export interface WorkerType {
  /** Where a new worker runs. */
  readonly cwd: string;
  /**
   * The exact message text for a prompt and the hook's modifiers, in this worker type's syntax.
   * Throws when the type cannot express the modifiers (a hook defect, which halts).
   */
  readonly composeMessage: (prompt: string, modifiers: ReadonlyArray<Modifier>) => string;
  /** Preload: checks an existing session and reads its directory and history. Spawns nothing. */
  readonly attach: (
    sessionId: string,
  ) => Effect.Effect<
    { readonly cwd: string; readonly history: ReadonlyArray<TranscriptEntry> },
    WorkerSetupError
  >;
  /**
   * Runs one worker process for as long as the stream is consumed: it reads `input`, and its
   * finalizer closes the process. An end or failure of the process fails the stream with a
   * `ToolFault`; interruption is teardown and records nothing.
   */
  readonly connect: (
    worker: { readonly sessionId: string; readonly resume: boolean; readonly cwd: string },
    input: Stream.Stream<WorkerMessage>,
  ) => Stream.Stream<WorkerEvent, ToolFault>;
}

/** The worker could not be set up: the session to preload cannot be attached. */
export class WorkerSetupError extends Schema.TaggedError<WorkerSetupError>()('WorkerSetupError', {
  sessionId: Schema.String,
  reason: Schema.Literals(['SessionNotFound', 'SessionUnreadable']),
}) {}
