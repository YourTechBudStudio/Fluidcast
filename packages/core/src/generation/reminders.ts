import { Schema } from 'effect';

import { isModelAuthored, type Action } from '../actions/index.ts';
import type { ToolDefinition } from './tools.ts';

/** The newest input a reminder can attach to. */
export type ReminderEvent =
  | {
      readonly _tag: 'ToolResult';
      /** The tool's name. */
      readonly tool: string;
      /** The result, decoded with the tool's `result` schema. */
      readonly result: unknown;
    }
  | {
      readonly _tag: 'UserMessage';
      readonly text: string;
      /** The message follows an interruption notice: the listener cut in to say it. */
      readonly interrupted: boolean;
    };

/**
 * The configuration's reminders, normally a preset's: a short note for the newest input, or
 * `undefined` for none. Tools supply none. Must be pure: history renders again on every iteration.
 */
export type Reminders = (event: ReminderEvent) => string | undefined;

/**
 * The reminder for the newest input, and the index of the action it follows. The newest input is
 * the latest tool result or user message in the final user run (after the last model-authored
 * action). For a tool result, every result since the run's latest user message shares one block:
 * their reminders in tool order, deduplicated. Empty or blank text counts as no reminder.
 */
export const newestReminder = (
  history: ReadonlyArray<Action>,
  tools: ReadonlyArray<ToolDefinition>,
  reminders: Reminders | undefined,
): { readonly after: number; readonly text: string } | undefined => {
  const runStart = history.findLastIndex(isModelAuthored) + 1;
  let newest = -1;
  for (let index = history.length - 1; index >= runStart; index--) {
    const type = history[index]?.type;
    if (type === 'tool_result' || type === 'user_message') {
      newest = index;
      break;
    }
  }
  const action = history[newest];
  if (action === undefined) return undefined;

  if (action.type === 'user_message') {
    let interrupted = false;
    for (let index = newest - 1; index >= runStart; index--) {
      const type = history[index]?.type;
      if (type === 'user_message') break;
      if (type === 'interrupted') {
        interrupted = true;
        break;
      }
    }
    const text = present(reminders?.({ _tag: 'UserMessage', text: action.text, interrupted }));
    return text === undefined ? undefined : { after: newest, text };
  }

  const results: Array<Extract<Action, { type: 'tool_result' }>> = [];
  for (let index = newest; index >= runStart; index--) {
    const candidate = history[index];
    if (candidate === undefined || candidate.type === 'user_message') break;
    if (candidate.type === 'tool_result') results.unshift(candidate);
  }
  const position = (name: string) => tools.findIndex((tool) => tool.name === name);
  const texts = results
    .toSorted((a, b) => position(a.tool) - position(b.tool))
    .map((result) => present(toolReminder(result, tools, reminders)))
    .filter((text): text is string => text !== undefined);
  const unique = [...new Set(texts)];
  return unique.length === 0 ? undefined : { after: newest, text: unique.join('\n') };
};

const toolReminder = (
  action: Extract<Action, { type: 'tool_result' }>,
  tools: ReadonlyArray<ToolDefinition>,
  reminders: Reminders | undefined,
): string | undefined => {
  if (reminders === undefined) return undefined;
  const tool = tools.find((candidate) => candidate.name === action.tool);
  if (tool === undefined) throw new Error('a tool result names a tool that is not configured');
  const result: unknown = Schema.decodeUnknownSync(tool.result)(action.result);
  return reminders({ _tag: 'ToolResult', tool: tool.name, result });
};

const present = (text: string | undefined): string | undefined =>
  text === undefined || text.trim() === '' ? undefined : text.trim();
