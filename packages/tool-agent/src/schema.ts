/**
 * The Forward Agent tool's contract: the model-facing input, results, the worker's status,
 * transcript entries, the Worker stream messages, skills and the `/name` syntax, everything a client
 * needs to recognise forward calls, present the worker and suggest skills. A pure export: it
 * imports only `effect`.
 */
import { Schema } from 'effect';

/** The model-facing action `type` of a forward call: it hands the conversation to the agent. */
export const forwardToolName = 'forward_agent';

/**
 * The model-facing input: nothing. The model writes `{"type":"forward_agent"}`; the worker receives the
 * listener's own words and the conversation since its last reply, built from the session. Extra
 * fields the model may add are ignored.
 */
export const ForwardInput = Schema.Struct({}).annotate({
  description:
    "Starts your work on the listener's latest words: it carries them, with what you said and showed since the last forward. It has no fields.",
});
export type ForwardInput = typeof ForwardInput.Type;

/** What the model reads for one busy period: the worker's top-level text messages, in order. */
export const ForwardResult = Schema.Struct({
  messages: Schema.Array(Schema.String),
});
export type ForwardResult = typeof ForwardResult.Type;

/** The line in a failed busy period's text that separates the error from what the worker wrote. */
export const forwardErrorMarker = 'What was written before stopping:';

const markerLine = `\n\n${forwardErrorMarker}\n\n`;

/**
 * The model-facing text of a failed busy period, with one owner for building and splitting it:
 * `The work stopped with an error (<outcome>).`, plus ` The usage limit resets at <ISO time>.` when
 * `resetsAt` (epoch seconds, as on `turnEnd`) is known, then, when the worker wrote anything, a
 * blank line, the marker line, a blank line and its messages joined by blank lines.
 */
export const forwardErrorMessage = (failure: {
  readonly outcome: string;
  readonly resetsAt?: number | undefined;
  readonly messages: ReadonlyArray<string>;
}): string => {
  const resets =
    failure.resetsAt === undefined
      ? ''
      : ` The usage limit resets at ${new Date(failure.resetsAt * 1000).toISOString()}.`;
  const error = `The work stopped with an error (${failure.outcome}).${resets}`;
  return failure.messages.length === 0
    ? error
    : `${error}${markerLine}${failure.messages.join('\n\n')}`;
};

/**
 * Splits `forwardErrorMessage` text at the first marker line. `written` is the joined text (not
 * separable into messages again), or `null` when the worker wrote nothing.
 */
export const forwardErrorParts = (
  message: string,
): { readonly error: string; readonly written: string | null } => {
  const at = message.indexOf(markerLine);
  return at === -1
    ? { error: message, written: null }
    : { error: message.slice(0, at), written: message.slice(at + markerLine.length) };
};

/**
 * - `idle`: nothing to do (never sent anything, or its last busy period succeeded);
 * - `working`: a busy period or an automatic turn runs;
 * - `failed`: its last busy period ended in an error, or its connection faulted.
 */
export const WorkerStatus = Schema.Literals(['idle', 'working', 'failed']);
export type WorkerStatus = typeof WorkerStatus.Type;

/**
 * The worker as the Worker view shows it, sent whenever its status or session ID changes.
 * `sessionId` is the agent's, `null` until a new worker's agent reports it.
 */
export const WorkerSummary = Schema.TaggedStruct('WorkerSummary', {
  status: WorkerStatus,
  sessionId: Schema.NullOr(Schema.String),
});
export type WorkerSummary = typeof WorkerSummary.Type;

/**
 * A skill or command token, such as `brainstorm`. The prompt itself is what it receives as arguments.
 * A worker type decides how many one message takes; Claude Code takes one.
 */
export interface Modifier {
  readonly name: string;
}

/** A valid modifier name, for every worker type and for one the listener types as `/name`. */
export const modifierName = /^[a-z0-9][a-z0-9:_-]*$/;

/**
 * Pure: a leading `/name` in a user message's text, and the words after it, trimmed. The first
 * whitespace-delimited token must be `/` and a valid name, with nothing before it; anything else
 * (`/`, `/Tmp`, `/tmp/notes.md`) is plain text.
 */
export const parseModifier = (
  text: string,
): { readonly modifier: Modifier; readonly words: string } | undefined => {
  const match = /^\/(\S*)([\s\S]*)$/.exec(text);
  if (match === null || !modifierName.test(match[1]!)) return undefined;
  return { modifier: { name: match[1]! }, words: match[2]!.trim() };
};

/**
 * A skill or command the worker can be sent as a modifier, for suggestions while the listener
 * types. `argumentHint` is absent when the skill declares none.
 */
export const Skill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  argumentHint: Schema.optionalKey(Schema.String),
});
export type Skill = typeof Skill.Type;

/** The worker type's skills could not be listed: it failed, or did not answer in time. */
export class SkillsUnavailable extends Schema.TaggedError<SkillsUnavailable>()(
  'SkillsUnavailable',
  {
    reason: Schema.Literals(['Failed', 'TimedOut']),
  },
) {}

/** The tool call an entry is nested under (a subagent's), or `null` at the top level. */
const Parent = { parentToolUseId: Schema.NullOr(Schema.String) };

/** One normalised item of the worker's transcript. */
export const TranscriptEntry = Schema.Union([
  /** Exactly what the worker was sent: by this Fluidcast session, or before it attached. */
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

/** The first message of a transcript stream: every entry so far. */
export const TranscriptSnapshot = Schema.TaggedStruct('TranscriptSnapshot', {
  entries: Schema.Array(TranscriptEntry),
});
/** Entries appended after the snapshot, in order. */
export const TranscriptAppended = Schema.TaggedStruct('TranscriptAppended', {
  entries: Schema.Array(TranscriptEntry),
});
export const TranscriptMessage = Schema.Union([TranscriptSnapshot, TranscriptAppended]);
export type TranscriptMessage = typeof TranscriptMessage.Type;

/** The Worker stream messages as JSON text, for any transport that carries them (the reference apps use SSE). */
export const WorkerSummaryJson = Schema.fromJsonString(WorkerSummary);
export const TranscriptMessageJson = Schema.fromJsonString(TranscriptMessage);
