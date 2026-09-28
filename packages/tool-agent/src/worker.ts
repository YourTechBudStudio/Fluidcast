/** The adapter contract between the SDK-neutral pool and one kind of worker (an agent SDK). */
import { Schema, type Effect, type Stream } from 'effect';

import type { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import type { Modifier } from './handoff.ts';
import type { TranscriptEntry } from './schema.ts';

/** One message for a worker. `id` is a UUID the worker reports back in `Consumed`. */
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
  /** The line the tool rules give this type. */
  readonly description: string;
  /** Where new workers of this type run. */
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
    AgentSetupError
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

/** The pool could not be set up: a preloaded worker is invalid or cannot be attached. */
export class AgentSetupError extends Schema.TaggedError<AgentSetupError>()('AgentSetupError', {
  agent: Schema.String,
  reason: Schema.Literals([
    'InvalidAgentId',
    'SessionNotFound',
    'SessionUnreadable',
    'DuplicateAgent',
  ]),
}) {}
