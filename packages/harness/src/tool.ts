import { Schema, type Effect, type Stream } from 'effect';

import type { ToolDefinition } from '@yourtechbudstudio/fluidcast-core/generation';

import type { ExecutionId, SessionState } from './session/protocol.ts';

/** How the Harness treats a tool's executions. */
export interface ToolPolicy {
  /**
   * Holds continuation, and every other result, until it completes. An Interrupt while it is open
   * cancels it without a result.
   */
  readonly blocking: boolean;
  /** Which outcomes the model reads. Completion is tracked regardless. */
  readonly response: 'all' | 'error' | 'none';
  /** Executes again when forward replay passes the call. */
  readonly replay: boolean;
}

/** A reached call the tool may place into one of its own open executions. */
export interface CallAssignment {
  /** The call's handle (`call_N`). */
  readonly handle: string;
  /** The session at reach: `effectiveActions(state)` ends with this call. */
  readonly state: SessionState;
  /** The ID a new execution for this call would get. */
  readonly executionId: ExecutionId;
}

/** What one execution receives besides its input. */
export interface InvocationContext<Command> {
  /** The call that opened this execution (`call_N`). Later calls may join it (`assign`). */
  readonly handle: string;
  readonly executionId: ExecutionId;
  /** The next validated client command for this execution. Take it again for another. */
  readonly awaitCommand: Effect.Effect<Command>;
  /**
   * Offers a progress update. `true`: accepted, for the model to read now or, while presentation
   * is held, kept as this execution's latest update (a newer one replaces it; completion drops it).
   * `false`: dropped, never queued.
   * Call it only from the execution's own work, never from `assign` or `context`: they run under
   * the session lock, and `progress` takes it.
   */
  readonly progress: (text: string) => Effect.Effect<boolean>;
}

/**
 * A tool the Harness can execute: Core's model-facing `ToolDefinition` plus execution. Tool
 * packages export a factory returning one; the Harness never branches on a tool's name.
 */
export interface Tool<Input = any, Result = any, Command = any> extends ToolDefinition<
  Input,
  Result
> {
  /**
   * The payloads a client may send to an execution with this input. Absent: every command is
   * rejected as invalid. A payload that does not decode is rejected, and the execution stays open.
   */
  readonly command?: (input: Input) => Schema.Codec<Command, Schema.Json>;
  readonly policy: ToolPolicy;
  /**
   * Which execution a newly reached call belongs to: `call.executionId` (a new one) or one of this
   * tool's open executions, which the call then joins, so that execution's one outcome completes it
   * too. Runs under the session lock on the first pass only, and must not wait or call `progress`.
   * Requires `policy.replay: false`. Absent: every call opens its own execution.
   */
  readonly assign?: (input: Input, call: CallAssignment) => Effect.Effect<ExecutionId>;
  /**
   * Text for the end of the model input, sampled under the session lock at the start of every
   * iteration and recorded as `tool_context` when it changed. `undefined`: nothing to say. Must not
   * wait or call `progress`.
   */
  readonly context?: Effect.Effect<string | undefined>;
  /** Failures outside any execution, consumed for the session's life. The first one halts. */
  readonly faults?: Stream.Stream<ToolFault>;
  /**
   * Invoked once per execution, when the cursor (or forward replay) reaches the call. It has no
   * requirements: services come through the tool's factory.
   */
  readonly run: (
    input: Input,
    context: InvocationContext<Command>,
  ) => Effect.Effect<Result, ToolError | ToolFault>;
}

/** An expected failure: completes the execution; the model reads `message` under response `all` or `error`. */
export class ToolError extends Schema.TaggedError<ToolError>()('ToolError', {
  message: Schema.String,
}) {}

/** An infrastructure failure: halts the conversation. `reason` is a display-safe identifier. */
export class ToolFault extends Schema.TaggedError<ToolFault>()('ToolFault', {
  reason: Schema.String,
}) {}
