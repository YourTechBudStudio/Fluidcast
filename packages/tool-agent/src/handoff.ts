/**
 * The hand-off: which part of the conversation the worker has not seen yet, as ordered entries, and
 * the default Markdown it receives. Built by code from session state, never summarised.
 */
import { Schema } from 'effect';

import type { Action, ToolCall } from '@yourtechbudstudio/fluidcast-core/actions';
import {
  effectiveActions,
  type PendingResult,
  type SessionState,
} from '@yourtechbudstudio/fluidcast-harness/protocol';
import {
  AskInput,
  AskResult,
  askToolName,
  type AskCommand,
} from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { ShowInput, showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { forwardToolName } from './schema.ts';

/** One item of the conversation the worker is handed, in log order. */
export type ConversationEntry =
  | {
      /** What the voice said, as the worker. */
      readonly kind: 'voice';
      /** The speaker's name, when several speakers are configured. */
      readonly speaker: string | undefined;
      readonly text: string;
    }
  | {
      readonly kind: 'show';
      readonly input: ShowInput;
      /** What session state proves: the client reported a render, has not reported yet, or reported a failure. */
      readonly status: 'rendered' | 'awaiting' | 'failed';
      readonly failure?: string;
    }
  | { readonly kind: 'question'; readonly input: AskInput; readonly answer: AskCommand | undefined }
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'interruption'; readonly during: 'speech' | 'wait' }
  | {
      /** Another tool's outcome (not Show, Ask or Forward). */
      readonly kind: 'toolOutcome';
      readonly tool: string;
      readonly outcome: 'result' | 'error';
      readonly text: string;
    };

/**
 * A skill or command token, such as `brainstorm`. The prompt itself is what it receives as arguments.
 * A worker type decides how many one message takes; Claude Code takes one.
 */
export interface Modifier {
  readonly name: string;
}

/** Everything the hook receives about one message to the worker. */
export interface Handoff {
  /**
   * The conversation since the last forward, or all of it for the worker's first message: what the
   * voice said and showed, and the listener's own words.
   */
  readonly conversation: ReadonlyArray<ConversationEntry>;
  /** The default text (`renderHandoff`). */
  readonly rendered: string;
  /** No earlier message was sent to the worker in this session (a new or preloaded worker). */
  readonly isFirstMessage: boolean;
}

/** What the hook returns: the prompt, and skill tokens the worker type composes with it. */
export interface HandoffPrompt {
  readonly prompt: string;
  readonly modifiers?: ReadonlyArray<Modifier>;
}

const decodeShow = Schema.decodeUnknownOption(ShowInput);
const decodeAsk = Schema.decodeUnknownOption(AskInput);
const decodeAskResult = Schema.decodeUnknownOption(AskResult);

type Outcome = Extract<Action, { readonly type: 'tool_result' | 'tool_errored' }>;

const isOutcome = (action: Action | PendingResult): action is Outcome =>
  action.type === 'tool_result' || action.type === 'tool_errored';

/**
 * Pure: the entries after the forward call `since` (or the whole conversation when `undefined`) up
 * to, not including, the forward call `handle`. Forward's own results are left out: the worker wrote
 * them.
 */
export const conversationSince = (
  state: SessionState,
  since: string | undefined,
  handle: string,
): ReadonlyArray<ConversationEntry> => {
  const actions = effectiveActions(state);

  // Calls anywhere in the log: a result in the window may answer a call before it.
  const calls = new Map<string, ToolCall>();
  const invalid = new Set<string>();
  for (const action of state.actions) {
    if (action.type !== 'tool_call') continue;
    calls.set(action.handle, action);
    const valid =
      action.tool === showToolName
        ? decodeShow(action.input)._tag === 'Some'
        : action.tool === askToolName
          ? decodeAsk(action.input)._tag === 'Some'
          : true;
    if (!valid) invalid.add(action.handle);
  }
  const outcomes = [...state.actions, ...state.pendingResults].filter(isOutcome);
  const outcomeOf = (call: string) => outcomes.find((outcome) => outcome.handles.includes(call));

  const start = since === undefined ? -1 : findCall(actions, since);
  const end = findCall(actions, handle);
  const window = actions.slice(start + 1, end === -1 ? actions.length : end);

  const speakerName = (id: string) =>
    state.speakers.length > 1
      ? (state.speakers.find((speaker) => speaker.id === id)?.name ?? id)
      : undefined;

  const entries: Array<ConversationEntry> = [];
  let paragraphSpeaker: string | undefined;
  const push = (entry: ConversationEntry) => {
    entries.push(entry);
    paragraphSpeaker = undefined;
  };

  for (const action of window) {
    switch (action.type) {
      case 'speak': {
        const last = entries.at(-1);
        if (last?.kind === 'voice' && paragraphSpeaker === action.speaker) {
          entries[entries.length - 1] = { ...last, text: `${last.text} ${action.text}` };
        } else {
          push({ kind: 'voice', speaker: speakerName(action.speaker), text: action.text });
          paragraphSpeaker = action.speaker;
        }
        break;
      }
      case 'user_message':
        push({ kind: 'user', text: action.text });
        break;
      case 'interrupted':
        push({ kind: 'interruption', during: action.during });
        break;
      case 'tool_call': {
        if (invalid.has(action.handle)) break;
        if (action.tool === showToolName) {
          const input = decodeShow(action.input);
          if (input._tag === 'None') break;
          const outcome = outcomeOf(action.handle);
          if (outcome?.type === 'tool_errored') {
            push({ kind: 'show', input: input.value, status: 'failed', failure: outcome.message });
          } else {
            const open = state.executions.some((execution) =>
              execution.handles.includes(action.handle),
            );
            push({ kind: 'show', input: input.value, status: open ? 'awaiting' : 'rendered' });
          }
        } else if (action.tool === askToolName) {
          const input = decodeAsk(action.input);
          if (input._tag === 'None') break;
          const outcome = outcomeOf(action.handle);
          const result =
            outcome?.type === 'tool_result' ? decodeAskResult(outcome.result) : undefined;
          push({
            kind: 'question',
            input: input.value,
            answer: result?._tag === 'Some' ? result.value.answer : undefined,
          });
        }
        break;
      }
      case 'tool_result':
      case 'tool_errored': {
        const folded = action.handles.some(
          (call) =>
            invalid.has(call) ||
            calls.get(call)?.tool === forwardToolName ||
            calls.get(call)?.tool === showToolName ||
            calls.get(call)?.tool === askToolName,
        );
        if (!folded) push(toolOutcome(action));
        break;
      }
      // Other calls, progress, context and failures are not conversation.
      default:
        break;
    }
  }
  return entries;
};

const findCall = (actions: ReadonlyArray<Action>, handle: string) =>
  actions.findIndex((action) => action.type === 'tool_call' && action.handle === handle);

const toolOutcome = (
  action: Outcome,
): Extract<ConversationEntry, { readonly kind: 'toolOutcome' }> =>
  action.type === 'tool_errored'
    ? { kind: 'toolOutcome', tool: action.tool, outcome: 'error', text: action.message }
    : {
        kind: 'toolOutcome',
        tool: action.tool,
        outcome: 'result',
        text: JSON.stringify(action.result),
      };

/** A fence one backtick longer than the longest backtick run in `content`, and at least three. */
const fenceFor = (content: string) => {
  const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map((run) => run[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
};

const showLabel = {
  rendered: 'Shown to the user',
  awaiting: "Being put on the user's screen, not yet confirmed",
  failed: 'Show failed to render',
} as const;

const renderAnswer = (answer: AskCommand | undefined): string => {
  if (answer === undefined) return '(not answered yet)';
  switch (answer.kind) {
    case 'text':
      return answer.text;
    case 'choice':
    case 'multi': {
      const chosen = answer.kind === 'choice' ? answer.choice : answer.choices.join('; ');
      const added = answer.text?.trim() ?? '';
      return added === '' ? chosen : `${chosen} — they added: ${added}`;
    }
    case 'continue':
      return 'Continue';
  }
};

/** One entry as Markdown. An interruption renders standalone; `renderConversation` merges one into the line it cut. */
export const renderEntry = (entry: ConversationEntry): string => {
  switch (entry.kind) {
    case 'voice':
      return entry.speaker === undefined
        ? `**Voice:** ${entry.text}`
        : `**Voice (${entry.speaker}):** ${entry.text}`;
    case 'interruption':
      return '*(The user interrupted to say something.)*';
    case 'show': {
      const { title, format, content } = entry.input;
      const titled = title === undefined ? '' : ` — "${title}"`;
      const failure = entry.status === 'failed' ? ` ${entry.failure ?? ''}` : '';
      const fence = fenceFor(content);
      return `**${showLabel[entry.status]}** (${format})${titled}:${failure}\n${fence}${format}\n${content}\n${fence}`;
    }
    case 'question': {
      const lines = [`**Question:** ${entry.input.question}`];
      if (entry.input.kind === 'choice' || entry.input.kind === 'multi') {
        lines.push(`Options: ${entry.input.options.map((option) => option.label).join(' · ')}`);
      }
      lines.push(`**Answer:** ${renderAnswer(entry.answer)}`);
      return lines.join('\n');
    }
    case 'user':
      return `**User:** ${entry.text}`;
    case 'toolOutcome': {
      const kind = entry.outcome === 'result' ? 'Result' : 'Error';
      return `**${kind} from \`${entry.tool}\`:**\n${entry.text}`;
    }
  }
};

/** The entries as Markdown, one blank line apart; a speech interruption marks the line it cut. */
export const renderConversation = (entries: ReadonlyArray<ConversationEntry>): string => {
  const blocks: Array<string> = [];
  entries.forEach((entry, index) => {
    if (
      entry.kind === 'interruption' &&
      entry.during === 'speech' &&
      entries[index - 1]?.kind === 'voice'
    ) {
      blocks[blocks.length - 1] += ' *(interrupted by the user)*';
    } else {
      blocks.push(renderEntry(entry));
    }
  });
  return blocks.join('\n\n');
};

/** The default text the worker receives. Nothing is XML-escaped. */
export const renderHandoff = (handoff: Omit<Handoff, 'rendered'>): string => {
  const [lead, tag] = handoff.isFirstMessage
    ? [
        'The user is talking with you through a voice conversation. A voice speaks to them as you, in the first person: it presents your responses in short spoken pieces, with material shown on their screen, and passes everything they say back to you. Here is that conversation so far.',
        'conversation_so_far',
      ]
    : [
        'Here is the voice conversation since the last message you received from it.',
        'conversation_since_last_message',
      ];
  const conversation =
    handoff.conversation.length === 0
      ? '(Nothing new was said.)'
      : renderConversation(handoff.conversation);
  return [
    lead,
    '',
    `<${tag}>`,
    conversation,
    `</${tag}>`,
    '',
    "Respond to the user's latest words. They are the user's own, and take precedence over anything the voice said or showed.",
    '',
    '- You are working unattended. The user hears and sees your response only through the voice, in pieces, so include everything needed in it.',
    '- The voice adds nothing of its own. When the user asks to slow down, repeat or re-explain something, do it in your response.',
    '- If anything said or shown to the user misrepresents your work, correct it in your response.',
    '- End your response with any questions for the user, as a numbered list under **Questions for you**. Do not use the AskUserQuestion tool.',
    '- Run tasks and shell commands in the foreground, not in the background.',
  ].join('\n');
};
