/**
 * The conversation projection: which actions of the log count as conversation, for each reader. The
 * one place that filters progress. A pure export: it imports only Core's action vocabulary, and it
 * keys on action types, never on tool names. The log itself is never changed (ADR 0002).
 *
 * The log reads as iterations, each an input and the reply to it. The input is the non-model actions
 * since the previous reply ended; the reply is a run of model-authored actions, closed by the
 * iteration's `generation_failed` when it failed. An input with real input (a message, an
 * interruption, a tool outcome or labeled context) is real. One with progress and no real input
 * answers only progress, and its reply is throwaway: speech that retells progress and carries
 * nothing once later input exists. An empty or neutral input (a retry, tool context, a fault)
 * inherits the kind of the input before it, or is real at the start of the log.
 *
 * A successful empty reply leaves no action, so one stretch of input can hold two iterations' inputs.
 * Progress after its last real action was submitted on its own (`ResultsSubmitted` puts kept
 * progress before results), so it is split off as its own progress-only input, after a real input
 * whose reply was empty.
 *
 * The current exchange runs from the latest input that is not inherited to the end of the log. It
 * stays whole in the model view, so a progress update is visible while it is the newest input, and
 * a retry still sees the reply it continues.
 *
 * A `history_compaction` is neutral input. Only the model view reads it: the latest one comes first,
 * in place of everything before its `from`.
 */
import {
  isModelAuthored,
  type Action,
  type ActionId,
  type HistoryCompaction,
  type Speak,
  type ToolCall,
} from '@yourtechbudstudio/fluidcast-core/actions';

type Answers = 'real' | 'progress';

type InputAction = Exclude<Action, Speak | ToolCall>;

interface Iteration {
  readonly input: ReadonlyArray<InputAction>;
  readonly reply: ReadonlyArray<Action>;
  readonly answers: Answers;
  /** Whether the input set `answers` itself rather than inheriting it. */
  readonly direct: boolean;
}

/** What an input action makes of its input: real, progress, or nothing. */
const inputKind = (action: InputAction): Answers | undefined => {
  switch (action.type) {
    case 'user_message':
    case 'interrupted':
    case 'tool_result':
    case 'tool_errored':
    case 'context':
      return 'real';
    case 'tool_progress':
      return 'progress';
    case 'tool_context':
    case 'generation_failed':
    case 'tool_faulted':
    case 'history_compaction':
      return undefined;
  }
};

const iterations = (actions: ReadonlyArray<Action>): Array<Iteration> => {
  const result: Array<Iteration> = [];
  let index = 0;
  while (index < actions.length) {
    const input: Array<InputAction> = [];
    for (
      let action = actions[index];
      action !== undefined && !isModelAuthored(action) && action.type !== 'generation_failed';
      action = actions[++index]
    ) {
      input.push(action);
    }
    const reply: Array<Action> = [];
    while (index < actions.length && isModelAuthored(actions[index]!)) {
      reply.push(actions[index++]!);
    }
    if (actions[index]?.type === 'generation_failed') reply.push(actions[index++]!);

    const kinds = input.map(inputKind);
    const lastReal = kinds.lastIndexOf('real');
    if (lastReal !== -1 && kinds.indexOf('progress', lastReal) !== -1) {
      result.push({
        input: input.slice(0, lastReal + 1),
        reply: [],
        answers: 'real',
        direct: true,
      });
      result.push({ input: input.slice(lastReal + 1), reply, answers: 'progress', direct: true });
      continue;
    }
    const own = lastReal !== -1 ? 'real' : kinds.includes('progress') ? 'progress' : undefined;
    result.push({
      input,
      reply,
      answers: own ?? result.at(-1)?.answers ?? 'real',
      direct: own !== undefined,
    });
  }
  return result;
};

/**
 * Drops throwaway replies and `tool_progress` envelopes: outside the current exchange when
 * `keepCurrentExchange` is set (the model view), else everywhere (the settled view). An
 * interruption after a dropped reply reads as cutting in to speak: the line it cut is gone.
 */
const project = (
  actions: ReadonlyArray<Action>,
  keepCurrentExchange: boolean,
): ReadonlyArray<Action> => {
  const all = iterations(actions);
  const current = all.findLastIndex((iteration) => iteration.direct);
  const projected: Array<Action> = [];
  let droppedReply = false;
  all.forEach((iteration, index) => {
    const kept = keepCurrentExchange && index >= current;
    for (const action of iteration.input) {
      if (action.type === 'tool_progress' && !kept) continue;
      projected.push(
        action.type === 'interrupted' && droppedReply ? { ...action, during: 'wait' } : action,
      );
    }
    droppedReply = iteration.answers === 'progress' && !kept;
    if (!droppedReply) projected.push(...iteration.reply);
  });
  return projected;
};

/** The log's actions from `from` onward, by ID. An unknown `from` is a defect: the log lost it. */
const idsFrom = (actions: ReadonlyArray<Action>, from: ActionId): ReadonlySet<ActionId> => {
  const index = actions.findIndex((action) => action.id === from);
  if (index === -1) throw new Error('a history summary starts at an action that is not in the log');
  return new Set(actions.slice(index).map((action) => action.id));
};

/**
 * Pure: the history as the voice model reads it. Progress shows only in the current exchange. With
 * a summary, the latest `history_compaction` comes first, then only the actions from its `from`
 * onward; no summary stays in its own place. Every `tool_context` is kept wherever it sits: it is
 * the tools' current state, recorded only when it changes, and renders once at the end.
 */
export const modelView = (actions: ReadonlyArray<Action>): ReadonlyArray<Action> => {
  const projected = project(actions, true);
  const summary = actions.findLast(
    (action): action is HistoryCompaction => action.type === 'history_compaction',
  );
  if (summary === undefined) return projected;
  const kept = idsFrom(actions, summary.from);
  return [
    summary,
    ...projected.filter(
      (action) =>
        action.type === 'tool_context' ||
        (action.type !== 'history_compaction' && kept.has(action.id)),
    ),
  ];
};

/**
 * Pure: the settled history, without any progress, replies to it, or summaries: what the worker's
 * hand-off reads, and what a summary folds in.
 */
export const settledView = (actions: ReadonlyArray<Action>): ReadonlyArray<Action> =>
  project(actions, false).filter((action) => action.type !== 'history_compaction');

/**
 * Pure: where the episode a reply to `actions` would start begins: the first action of the current
 * exchange's input, so a retry still starts at the input it retries. Absent for an empty log.
 */
export const episodeStart = (actions: ReadonlyArray<Action>): ActionId | undefined => {
  const all = iterations(actions);
  return all.findLast((iteration) => iteration.direct)?.input[0]?.id ?? all[0]?.input[0]?.id;
};

/**
 * Pure: what a summary folds in: the settled view of the whole log, cut to the actions from `from`
 * (the log start when absent) up to, not including, `to`, without tool context, which describes a
 * tool's state at one moment rather than the conversation. Both IDs must be in the log.
 */
export const summarySlice = (
  actions: ReadonlyArray<Action>,
  from: ActionId | undefined,
  to: ActionId,
): ReadonlyArray<Action> => {
  const after = from === undefined ? undefined : idsFrom(actions, from);
  const before = idsFrom(actions, to);
  return settledView(actions).filter(
    (action) =>
      action.type !== 'tool_context' &&
      (after === undefined || after.has(action.id)) &&
      !before.has(action.id),
  );
};

/**
 * Pure: whether the next reply to `actions` answers only progress, so it is throwaway: its speech
 * plays, and its tool calls are ignored. A retry answers what the failed reply answered.
 */
export const answersProgress = (actions: ReadonlyArray<Action>): boolean =>
  iterations(actions).at(-1)?.answers === 'progress';
