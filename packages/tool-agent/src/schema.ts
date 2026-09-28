/**
 * The Agent tool's contract: the model-facing input, results, worker statuses, transcript entries
 * and the Workers stream messages, everything a client needs to recognise agent calls and present
 * workers. A pure export: it imports only `effect`.
 */
import { Schema } from 'effect';

/** The model-facing action `type` of an agent call. */
export const agentToolName = 'agent';

/** Agent IDs: short and lowercase, so one worker cannot become two by a change of case. */
export const AgentId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/));

/** The model-facing input for the configured worker types (flat; `agentType`, never `type`). */
export const agentInput = (types: readonly [string, ...Array<string>]) =>
  Schema.Struct({
    agentType: Schema.Literals(types).annotate({
      description: 'Which kind of worker, from the tool rules.',
    }),
    agent: AgentId.annotate({
      description:
        'The worker id, a short lowercase name such as `brainstorm`. Reuse it to continue with the same worker; a new id starts a new worker.',
    }),
    message: Schema.NonEmptyString.annotate({
      description:
        'Only your instruction to the worker. It already sees the conversation, so never retell it.',
    }),
  });

/** What the model writes to the Agent tool. */
export type AgentInput = ReturnType<typeof agentInput>['Type'];

/** Any agent call as clients read it, whatever types a backend configured. */
export const AgentCall = Schema.Struct({
  agentType: Schema.String,
  agent: Schema.String,
  message: Schema.String,
});
export type AgentCall = typeof AgentCall.Type;

/** What the model reads for one busy period: the worker's top-level text messages, in order. */
export const AgentResult = Schema.Struct({
  agent: Schema.String,
  messages: Schema.Array(Schema.String),
});
export type AgentResult = typeof AgentResult.Type;

/** The line in a failed busy period's text that separates the error from what the worker wrote. */
export const agentErrorMarker = 'What it wrote before stopping:';

const markerLine = `\n\n${agentErrorMarker}\n\n`;

/**
 * The model-facing text of a failed busy period, with one owner for building and splitting it:
 * `The worker "<id>" stopped with an error (<outcome>).`, then, when the worker wrote anything, a
 * blank line, the marker line, a blank line and its messages joined by blank lines.
 */
export const agentErrorMessage = (failure: {
  readonly agent: string;
  readonly outcome: string;
  readonly messages: ReadonlyArray<string>;
}): string => {
  const error = `The worker "${failure.agent}" stopped with an error (${failure.outcome}).`;
  return failure.messages.length === 0
    ? error
    : `${error}${markerLine}${failure.messages.join('\n\n')}`;
};

/**
 * Splits `agentErrorMessage` text at the first marker line. `written` is the joined text (not
 * separable into messages again), or `null` when the worker wrote nothing.
 */
export const agentErrorParts = (
  message: string,
): { readonly error: string; readonly written: string | null } => {
  const at = message.indexOf(markerLine);
  return at === -1
    ? { error: message, written: null }
    : { error: message.slice(0, at), written: message.slice(at + markerLine.length) };
};

export const WorkerStatus = Schema.Literals(['working', 'done', 'failed']);
export type WorkerStatus = typeof WorkerStatus.Type;

/** One worker as the Workers list shows it. */
export const WorkerSummary = Schema.Struct({
  agent: Schema.String,
  agentType: Schema.String,
  status: WorkerStatus,
  sessionId: Schema.String,
});
export type WorkerSummary = typeof WorkerSummary.Type;

/** The tool call an entry is nested under (a subagent's), or `null` at the top level. */
const Parent = { parentToolUseId: Schema.NullOr(Schema.String) };

/** One normalised item of a worker's transcript. */
export const TranscriptEntry = Schema.Union([
  /** Exactly what a worker was sent: by this Fluidcast session, or before it attached. */
  Schema.TaggedStruct('prompt', {
    ...Parent,
    source: Schema.Literals(['fluidcast', 'earlier']),
    text: Schema.String,
  }),
  /** Text the worker wrote, as Markdown. */
  Schema.TaggedStruct('text', { ...Parent, text: Schema.String }),
  /** A tool call; `input` is its JSON text, capped, with `truncated` saying whether the cap applied. */
  Schema.TaggedStruct('toolCall', {
    ...Parent,
    toolUseId: Schema.String,
    name: Schema.String,
    input: Schema.String,
    truncated: Schema.Boolean,
  }),
  /** A tool call's result text, capped, with `truncated` saying whether the cap applied. */
  Schema.TaggedStruct('toolResult', {
    ...Parent,
    toolUseId: Schema.String,
    content: Schema.String,
    truncated: Schema.Boolean,
    isError: Schema.Boolean,
  }),
  /** A subagent's progress summary. */
  Schema.TaggedStruct('status', { ...Parent, text: Schema.String }),
  /** A turn ended: `success`, or a display-safe error tag such as `error_max_turns` or `usage_limit` (with when it resets, epoch seconds, if known). */
  Schema.TaggedStruct('turnEnd', {
    ...Parent,
    outcome: Schema.String,
    resetsAt: Schema.optionalKey(Schema.Number),
  }),
]);
export type TranscriptEntry = typeof TranscriptEntry.Type;

/** The whole worker list, sent whenever it changes. */
export const WorkerList = Schema.TaggedStruct('WorkerList', {
  workers: Schema.Array(WorkerSummary),
});
export type WorkerList = typeof WorkerList.Type;

/** The first message of a transcript stream: every entry so far. */
export const TranscriptSnapshot = Schema.TaggedStruct('TranscriptSnapshot', {
  agent: Schema.String,
  sessionId: Schema.String,
  entries: Schema.Array(TranscriptEntry),
});
/** Entries appended after the snapshot, in order. */
export const TranscriptAppended = Schema.TaggedStruct('TranscriptAppended', {
  entries: Schema.Array(TranscriptEntry),
});
export const TranscriptMessage = Schema.Union([TranscriptSnapshot, TranscriptAppended]);
export type TranscriptMessage = typeof TranscriptMessage.Type;

/** The Workers stream messages as JSON text, for any transport that carries them (the reference apps use SSE). */
export const WorkerListJson = Schema.fromJsonString(WorkerList);
export const TranscriptMessageJson = Schema.fromJsonString(TranscriptMessage);

/** No worker has this agent ID. */
export class WorkerNotFound extends Schema.TaggedError<WorkerNotFound>()('WorkerNotFound', {
  agent: Schema.String,
}) {}
