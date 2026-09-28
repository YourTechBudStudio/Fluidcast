import { Schema } from 'effect';
import type { Prompt } from 'effect/unstable/ai';

import {
  isModelAuthored,
  type Action,
  type Speak,
  type ToolCall,
  type ToolContext,
} from '../actions/index.ts';
import type { ToolDefinition } from './tools.ts';

export const interruptedNotice = 'You were interrupted during your last line.';
export const interruptedToSpeakNotice = 'The user interrupted to say something.';
export const cutOffNotice =
  'Your previous response was cut off after the last line. Continue from there.';
export const failedBeforeLinesNotice =
  'Your previous response failed before any lines were delivered. Respond again.';

type Run =
  | { readonly role: 'assistant'; readonly items: Array<object> }
  | { readonly role: 'user'; readonly items: Array<string> };

/**
 * Renders the history (the actions up to the cursor) as native chat messages. Each run of
 * model-authored actions becomes one assistant message holding their JSON array; each run of other
 * actions becomes one user message of XML envelopes, with user text entity-encoded. A tool call
 * reads as the model wrote it, with its handle as `call`; a tool outcome or progress update reads as
 * a `<tool_result>`, `<tool_error>` or `<tool_progress>` envelope naming its handles and the tool.
 * Action IDs never reach the model.
 *
 * A `tool_context` renders nothing in place. The latest one per tool, when not empty, closes the
 * input as `<context tool="…">`, in `tools` order, so the current context always comes last.
 *
 * A stored result is decoded and rendered with its tool again on every call, so `tools` must be the
 * configuration the log was built with; a mismatch throws.
 */
export const renderHistory = (
  history: ReadonlyArray<Action>,
  tools: ReadonlyArray<ToolDefinition>,
): Array<Prompt.UserMessageEncoded | Prompt.AssistantMessageEncoded> => {
  const runs: Array<Run> = [];
  history.forEach((action, index) => {
    const last = runs.at(-1);
    if (isModelAuthored(action)) {
      const content = modelContent(action);
      if (last?.role === 'assistant') last.items.push(content);
      else runs.push({ role: 'assistant', items: [content] });
    } else {
      const item = envelope(action, history[index - 1], tools);
      if (item === undefined) return;
      if (last?.role === 'user') last.items.push(item);
      else runs.push({ role: 'user', items: [item] });
    }
  });
  const contexts = latestContexts(history, tools);
  if (contexts.length > 0) {
    const last = runs.at(-1);
    // A guard: every entry path ends the history with a user-role run.
    if (last?.role === 'user') last.items.push(...contexts);
    else runs.push({ role: 'user', items: contexts });
  }
  return runs.map((run) =>
    run.role === 'assistant'
      ? { role: 'assistant', content: JSON.stringify(run.items) }
      : { role: 'user', content: run.items.join('\n') },
  );
};

/** Each tool's latest non-empty `tool_context`, as envelopes in `tools` order. */
const latestContexts = (
  history: ReadonlyArray<Action>,
  tools: ReadonlyArray<ToolDefinition>,
): Array<string> =>
  tools.flatMap((tool) => {
    const latest = history.findLast(
      (action): action is ToolContext =>
        action.type === 'tool_context' && action.tool === tool.name,
    );
    return latest === undefined || latest.text === ''
      ? []
      : [`<context tool="${escapeAttribute(tool.name)}">${escapeXml(latest.text)}</context>`];
  });

/** The action as the model wrote it: a speak without its ID, or a tool call as `{ type, call, ...input }`. */
const modelContent = (action: Speak | ToolCall): object => {
  if (action.type === 'speak') {
    const { id: _id, ...content } = action;
    return content;
  }
  return { type: action.tool, call: action.handle, ...action.input };
};

/** The action's line in a user message, or `undefined` for an action the model never reads. */
const envelope = (
  action: Exclude<Action, Speak | ToolCall>,
  previous: Action | undefined,
  tools: ReadonlyArray<ToolDefinition>,
): string | undefined => {
  switch (action.type) {
    case 'user_message':
      return `<user_message>${escapeXml(action.text)}</user_message>`;
    case 'interrupted':
      return `<notice>${action.during === 'speech' ? interruptedNotice : interruptedToSpeakNotice}</notice>`;
    case 'generation_failed':
      return `<notice>${previous !== undefined && isModelAuthored(previous) ? cutOffNotice : failedBeforeLinesNotice}</notice>`;
    case 'tool_result':
      return `<tool_result ${callsAttribute(action.handles)} tool="${escapeAttribute(action.tool)}">${escapeXml(renderResult(action, tools))}</tool_result>`;
    case 'tool_errored':
      return `<tool_error ${callsAttribute(action.handles)} tool="${escapeAttribute(action.tool)}">${escapeXml(action.message)}</tool_error>`;
    case 'tool_progress':
      return `<tool_progress ${callsAttribute(action.handles)} tool="${escapeAttribute(action.tool)}">${escapeXml(action.text)}</tool_progress>`;
    case 'tool_context':
      // Rendered once, at the end of the input.
      return undefined;
    case 'tool_faulted':
      // Nothing generates after a halt.
      return undefined;
  }
};

/** `call="call_3"` for one handle, `calls="call_3 call_7"` for several. */
const callsAttribute = (handles: ReadonlyArray<string>): string => {
  const value = handles.map(escapeAttribute).join(' ');
  return handles.length === 1 ? `call="${value}"` : `calls="${value}"`;
};

/** Reads a stored result as its tool renders it. Throws when the log and the tools disagree. */
const renderResult = (
  action: Extract<Action, { type: 'tool_result' }>,
  tools: ReadonlyArray<ToolDefinition>,
): string => {
  const tool = tools.find((candidate) => candidate.name === action.tool);
  if (tool === undefined) throw new Error('a tool result names a tool that is not configured');
  return tool.renderResult(Schema.decodeUnknownSync(tool.result)(action.result));
};

/** Encodes markup characters so user text cannot close its envelope or forge a `<notice>`. */
const escapeXml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Also encodes quotes, so a value cannot end its attribute. */
const escapeAttribute = (text: string): string => escapeXml(text).replaceAll('"', '&quot;');
