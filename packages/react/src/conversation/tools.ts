import { Option, Schema } from 'effect';

import type { Execution, ExecutionId } from '@yourtechbudstudio/fluidcast-harness/protocol';
import { ForwardResult, forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import {
  type AskCommand,
  AskInput,
  AskResult,
  askToolName,
} from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { ShowInput, showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import type { ShowCorrection } from '../tools';
import type { Action, ConversationView } from './model';

/**
 * Pure derivations of the Show, Ask and Forward tools from the view. The player recognises the tools by name, through
 * each tool package's pure `./schema` entry, and never imports a tool's backend.
 */

export type ToolCall = Extract<Action, { type: 'tool_call' }>;
export type ToolResult = Extract<Action, { type: 'tool_result' }>;

const decodeShow = Schema.decodeUnknownOption(ShowInput);
const decodeAsk = Schema.decodeUnknownOption(AskInput);
const decodeAskResult = Schema.decodeUnknownOption(AskResult);
const decodeForwardResult = Schema.decodeUnknownOption(ForwardResult);

// A logged action never changes, so each is decoded once.
const shows = new WeakMap<ToolCall, ShowInput | undefined>();
const asks = new WeakMap<ToolCall, AskInput | undefined>();

const cached = <A>(
  cache: WeakMap<ToolCall, A | undefined>,
  call: ToolCall,
  decode: () => A | undefined,
): A | undefined => {
  if (!cache.has(call)) cache.set(call, decode());
  return cache.get(call);
};

export const findCall = (view: ConversationView, handle: string): ToolCall | undefined =>
  view.actions.find(
    (action): action is ToolCall => action.type === 'tool_call' && action.handle === handle,
  );

/** The Show a call makes, when it is a `show` call whose input is valid. */
export const showOf = (call: ToolCall | undefined): ShowInput | undefined =>
  call?.tool === showToolName
    ? cached(shows, call, () => Option.getOrUndefined(decodeShow(call.input)))
    : undefined;

/** The question a call asks, when it is an `ask` call whose input is valid. */
export const askOf = (call: ToolCall | undefined): AskInput | undefined =>
  call?.tool === askToolName
    ? cached(asks, call, () => Option.getOrUndefined(decodeAsk(call.input)))
    : undefined;

/**
 * Whether a call is a `forward`: it hands the listener's words to the worker. Its input has no fields (any the model
 * added are ignored), so every `forward` call is valid.
 */
export const isForward = (call: ToolCall | undefined): boolean => call?.tool === forwardToolName;

/** When the open Forward execution started (epoch milliseconds), if one is open. */
export const forwardThinkingSince = (view: ConversationView): number | undefined => {
  const starts = view.executions
    .filter((execution) => execution.tool === forwardToolName)
    .map((execution) => execution.startedAt);
  return starts.length === 0 ? undefined : Math.min(...starts);
};

/**
 * The messages a forward result carries, in order. A result that does not decode is shown as one message holding its
 * JSON text, so nothing the model read is hidden.
 */
export const forwardResultOf = (result: ToolResult): ReadonlyArray<string> =>
  Option.match(decodeForwardResult(result.result), {
    onSome: (decoded) => decoded.messages,
    onNone: () => [JSON.stringify(result.result, null, 2)],
  });

/** The answer an Ask result carries. */
export const answerOf = (result: ToolResult): AskCommand | undefined =>
  result.tool === askToolName
    ? Option.getOrUndefined(decodeAskResult(result.result))?.answer
    : undefined;

/** The last valid Show call in the view: what the Show button opens. */
export const latestShowHandle = (view: ConversationView): string | undefined =>
  view.actions.findLast(
    (action): action is ToolCall => action.type === 'tool_call' && showOf(action) !== undefined,
  )?.handle;

/** The earliest open Ask, with its question. An open execution's call is always in the view. */
export const openAsk = (
  view: ConversationView,
): { readonly execution: Execution; readonly input: AskInput } | undefined => {
  for (const execution of view.executions) {
    if (execution.tool !== askToolName) continue;
    const input = askOf(findCall(view, execution.handles[0]));
    if (input) return { execution, input };
  }
  return undefined;
};

/** The last Ask answer waiting to be submitted, with its question. */
export const pendingAnswer = (
  view: ConversationView,
):
  | { readonly handle: string; readonly input: AskInput; readonly answer: AskCommand }
  | undefined => {
  for (const result of view.pendingResults.toReversed()) {
    if (result.type !== 'tool_result' || result.tool !== askToolName) continue;
    // An Ask execution holds only its own call.
    const [handle] = result.handles;
    const input = askOf(findCall(view, handle));
    const answer = answerOf(result);
    if (input && answer) return { handle, input, answer };
  }
  return undefined;
};

type ToolErrored = Extract<Action, { type: 'tool_errored' }>;

/** The error a call ended with, and whether the model has read it (`submitted`) or it is still pending. */
export const toolErrorOf = (
  view: ConversationView,
  handle: string,
): { readonly message: string; readonly submitted: boolean } | undefined => {
  const matches = (action: Action | ToolErrored): action is ToolErrored =>
    action.type === 'tool_errored' && action.handles.includes(handle);
  const submitted = view.actions.find(matches);
  if (submitted) return { message: submitted.message, submitted: true };
  const pending = view.pendingResults.find(matches);
  return pending && { message: pending.message, submitted: false };
};

/**
 * Where a Show's render failure stands on the way back to the model. Only the latest Show's failure can be
 * corrected, and nothing more is generated after a halt. The error is `sent` once it is in the log, and `pending`
 * while it is being reported or waits to be submitted, unless its report was not accepted (`unresolved`): then the
 * model will never read it. A replacement is `awaited` only while the turn that made the Show is still going: the
 * phase says only that some turn is, so a later message from the listener, or an interrupt, ends the wait for good.
 */
export const showCorrectionOf = (
  view: ConversationView,
  handle: string,
  unresolved: ReadonlySet<ExecutionId>,
): ShowCorrection => {
  if (handle !== latestShowHandle(view) || view.phase === 'halted') return null;
  const call = view.actions.findIndex(
    (action) => action.type === 'tool_call' && action.handle === handle,
  );
  const awaited =
    (view.phase === 'speaking' || view.phase === 'waiting' || view.phase === 'working') &&
    !view.actions
      .slice(call + 1)
      .some((action) => action.type === 'user_message' || action.type === 'interrupted');
  if (toolErrorOf(view, handle)?.submitted) return { error: 'sent', awaited };
  return view.executions.some(
    (execution) => execution.handles.includes(handle) && unresolved.has(execution.executionId),
  )
    ? null
    : { error: 'pending', awaited };
};

/** The answer a call received, submitted (`pending: false`) or still pending. */
export const answerFor = (
  view: ConversationView,
  handle: string,
): { readonly answer: AskCommand; readonly pending: boolean } | undefined => {
  for (const [results, pending] of [
    [view.actions, false],
    [view.pendingResults, true],
  ] as const) {
    for (const action of results) {
      if (action.type !== 'tool_result' || !action.handles.includes(handle)) continue;
      const answer = answerOf(action);
      if (answer) return { answer, pending };
    }
  }
  return undefined;
};

/**
 * Where the model's current turn begins: the latest user message, submitted tool outcome or used progress update,
 * since a continuation or a progress iteration starts a new model turn too. `-1` when there is none.
 */
export const turnBoundary = (view: ConversationView): number =>
  view.actions.findLastIndex(
    (action) =>
      action.type === 'user_message' ||
      action.type === 'tool_result' ||
      action.type === 'tool_errored' ||
      action.type === 'tool_progress',
  );
