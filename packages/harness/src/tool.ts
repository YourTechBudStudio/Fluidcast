import { Schema, type Effect } from 'effect';

import type { ToolDefinition } from '@yourtechbudstudio/fluidcast-core/generation';

/** How the Harness treats a tool's executions. */
export interface ToolPolicy {
  /** Holds continuation, and every other result, until it completes. Interrupt is ignored while it is open. */
  readonly blocking: boolean;
  /** Which outcomes the model reads. Completion is tracked regardless. */
  readonly response: 'all' | 'error' | 'none';
  /** Executes again when forward replay passes the call. */
  readonly replay: boolean;
}

/** What one execution receives besides its input. */
export interface InvocationContext<Command> {
  /** The handle of the call being executed (`call_N`). */
  readonly handle: string;
  /** The next validated client command for this execution. Take it again for another. */
  readonly awaitCommand: Effect.Effect<Command>;
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
