/**
 * The hand-off: which part of the conversation a worker has not seen yet, as ordered entries, and
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

import { AgentCall, AgentResult, agentToolName } from './schema.ts';

/** One item of the conversation a worker is handed, in log order. */
export type ConversationEntry =
  | {
      readonly kind: 'interfaceAgent';
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
      readonly kind: 'toolOutcome';
      readonly tool: string;
      /** The worker, for another worker's outcome. */
      readonly agent?: string;
      readonly outcome: 'result' | 'error';
      readonly text: string;
    };

/** A skill or command token, such as `brainstorm`. The prompt itself is what it receives as arguments. */
export interface Modifier {
  readonly name: string;
}

/** Everything the hook receives about one message to a worker. */
export interface Handoff {
  readonly agentType: string;
  readonly agent: string;
  /** The interface agent's `message`. */
  readonly instruction: string;
  /** The conversation since the last message to this worker, or all of it for its first message. */
  readonly conversation: ReadonlyArray<ConversationEntry>;
  /** The default text (`renderHandoff`). */
  readonly rendered: string;
  /** No earlier message was sent to this worker in this session (a new or preloaded worker). */
  readonly isFirstMessage: boolean;
}

/** What the hook returns: the prompt, and skill tokens the worker type composes with it. */
export interface HandoffPrompt {
  readonly prompt: string;
  readonly modifiers?: ReadonlyArray<Modifier>;
}

/** What the model and other workers read for an agent result: its messages joined by blank lines. */
export const renderAgentResult = ({ messages }: AgentResult): string =>
  messages.length === 0 ? '(The worker wrote no text.)' : messages.join('\n\n');

const decodeShow = Schema.decodeUnknownOption(ShowInput);
const decodeAsk = Schema.decodeUnknownOption(AskInput);
const decodeAskResult = Schema.decodeUnknownOption(AskResult);
const decodeAgentCall = Schema.decodeUnknownOption(AgentCall);
const decodeAgentResult = Schema.decodeUnknownOption(AgentResult);

type Outcome = Extract<Action, { readonly type: 'tool_result' | 'tool_errored' }>;

const isOutcome = (action: Action | PendingResult): action is Outcome =>
  action.type === 'tool_result' || action.type === 'tool_errored';

/**
 * Pure: the entries after the call `since` (or the whole conversation when `undefined`) up to, not
 * including, the call `handle`. `own` is the worker being handed the conversation: its own results
 * are left out. `agentInput` is the Agent tool's real input schema, so agent calls the Harness
 * rejected count as invalid.
 */
export const conversationSince = (
  state: SessionState,
  since: string | undefined,
  handle: string,
  own: string,
  agentInput: Schema.Decoder<unknown>,
): ReadonlyArray<ConversationEntry> => {
  const actions = effectiveActions(state);
  const decodeAgentInput = Schema.decodeUnknownOption(agentInput);

  // Calls anywhere in the log: a result in the window may answer a call before it.
  const calls = new Map<string, ToolCall>();
  const ownHandles = new Set<string>();
  const invalid = new Set<string>();
  for (const action of state.actions) {
    if (action.type !== 'tool_call') continue;
    calls.set(action.handle, action);
    const valid =
      action.tool === showToolName
        ? decodeShow(action.input)._tag === 'Some'
        : action.tool === askToolName
          ? decodeAsk(action.input)._tag === 'Some'
          : action.tool === agentToolName
            ? decodeAgentInput(action.input)._tag === 'Some'
            : true;
    if (!valid) invalid.add(action.handle);
    else if (action.tool === agentToolName && agentOf(action) === own)
      ownHandles.add(action.handle);
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
        if (last?.kind === 'interfaceAgent' && paragraphSpeaker === action.speaker) {
          entries[entries.length - 1] = { ...last, text: `${last.text} ${action.text}` };
        } else {
          push({ kind: 'interfaceAgent', speaker: speakerName(action.speaker), text: action.text });
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
            ownHandles.has(call) ||
            calls.get(call)?.tool === showToolName ||
            calls.get(call)?.tool === askToolName,
        );
        if (!folded) push(toolOutcome(action, calls));
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

const agentOf = (call: ToolCall | undefined): string | undefined => {
  const decoded = call === undefined ? undefined : decodeAgentCall(call.input);
  return decoded?._tag === 'Some' ? decoded.value.agent : undefined;
};

const toolOutcome = (
  action: Outcome,
  calls: ReadonlyMap<string, ToolCall>,
): Extract<ConversationEntry, { readonly kind: 'toolOutcome' }> => {
  if (action.type === 'tool_errored') {
    const agent = action.tool === agentToolName ? agentOf(calls.get(action.handles[0])) : undefined;
    return {
      kind: 'toolOutcome',
      tool: action.tool,
      ...(agent === undefined ? {} : { agent }),
      outcome: 'error',
      text: action.message,
    };
  }
  const result = action.tool === agentToolName ? decodeAgentResult(action.result) : undefined;
  return result?._tag === 'Some'
    ? {
        kind: 'toolOutcome',
        tool: action.tool,
        agent: result.value.agent,
        outcome: 'result',
        text: renderAgentResult(result.value),
      }
    : {
        kind: 'toolOutcome',
        tool: action.tool,
        outcome: 'result',
        text: JSON.stringify(action.result),
      };
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
  }
};

/** One entry as Markdown. An interruption renders standalone; `renderConversation` merges one into the line it cut. */
export const renderEntry = (entry: ConversationEntry): string => {
  switch (entry.kind) {
    case 'interfaceAgent':
      return entry.speaker === undefined
        ? `**Interface agent:** ${entry.text}`
        : `**Interface agent (${entry.speaker}):** ${entry.text}`;
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
      if (entry.input.kind !== 'text') {
        lines.push(`Options: ${entry.input.options.map((option) => option.label).join(' · ')}`);
      }
      lines.push(`**Answer:** ${renderAnswer(entry.answer)}`);
      return lines.join('\n');
    }
    case 'user':
      return `**User:** ${entry.text}`;
    case 'toolOutcome': {
      const source = entry.agent === undefined ? `\`${entry.tool}\`` : `agent "${entry.agent}"`;
      const kind = entry.outcome === 'result' ? 'Result' : 'Error';
      return `**${kind} from ${source}:**\n${entry.text}`;
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
      entries[index - 1]?.kind === 'interfaceAgent'
    ) {
      blocks[blocks.length - 1] += ' *(interrupted by the user)*';
    } else {
      blocks.push(renderEntry(entry));
    }
  });
  return blocks.join('\n\n');
};

/** The default text a worker receives: the story's hand-off format. Nothing is XML-escaped. */
export const renderHandoff = (handoff: Omit<Handoff, 'rendered'>): string => {
  const [lead, tag] = handoff.isFirstMessage
    ? [
        'The user is talking with you through a voice conversation. Here is that conversation so far.',
        'conversation_so_far',
      ]
    : [
        'The user responded through the voice conversation since your last message.',
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
    '<instruction>',
    handoff.instruction,
    '</instruction>',
    '',
    "Interpret the instruction in light of the conversation above and our earlier conversation. Where they disagree, the user's own words take precedence over the instruction.",
    '',
    '- You are working unattended. A voice agent presents your responses to the user in pieces and relays their reactions back to you.',
    '- Put any questions for the user in your response. Do not use the AskUserQuestion tool.',
    '- If anything shown or said to the user misrepresents your work, correct it in your response.',
    '- Run tasks and shell commands in the foreground, not in the background.',
    '',
    'Your response will be presented to the user by voice, in pieces. Include everything needed in it.',
  ].join('\n');
};
