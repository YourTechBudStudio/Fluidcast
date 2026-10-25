import type {
  TranscriptEntry,
  WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import type { WorkersFeed } from './state';
import { shortInput } from './transcript';

/** The entries the strip shows as text. */
export type ActivityEntry = Extract<
  TranscriptEntry,
  { readonly _tag: 'thinking' | 'toolCall' | 'text' | 'status' }
>;

/**
 * What the worker strip shows:
 * - `entry`: the main agent's latest event, keyed by its transcript position (stable: entries are only appended);
 * - `background`: the main agent's turn ended, and this many of its background tasks still run.
 */
export type WorkerActivity =
  | { readonly kind: 'entry'; readonly entry: ActivityEntry; readonly key: string }
  | { readonly kind: 'background'; readonly count: number };

/**
 * The strip's activity, or `null` when there is none to show: unless both feeds are live and the worker is working
 * (a reconnecting feed holds stale data), and before the turn's first event, which is never invented. Only top-level
 * entries count; subagent steps only pulse (see `pulseKey`).
 */
export const workerActivity = (
  worker: WorkersFeed<WorkerSummary>,
  transcript: WorkersFeed<ReadonlyArray<TranscriptEntry>>,
): WorkerActivity | null => {
  const summary = worker.data;
  const entries = transcript.data;
  if (worker.connection !== 'live' || transcript.connection !== 'live') return null;
  if (summary?.status !== 'working' || entries === undefined) return null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.parentToolUseId !== null) continue;
    switch (entry._tag) {
      case 'toolResult':
        continue;
      case 'prompt':
        return null;
      case 'turnEnd':
        return summary.backgroundTasks > 0
          ? { kind: 'background', count: summary.backgroundTasks }
          : null;
      case 'thinking':
      case 'toolCall':
      case 'text':
      case 'status':
        return { kind: 'entry', entry, key: `${i}` };
    }
  }
  return null;
};

/** Changes with every new entry of any depth, so each one, subagent steps included, sends one sweep. */
export const pulseKey = (entries: ReadonlyArray<TranscriptEntry> | undefined): number =>
  entries?.length ?? 0;

export interface ActivityLine {
  readonly label: string;
  /** `''` when there is none. */
  readonly detail: string;
  /** The label shimmers. */
  readonly thinking: boolean;
}

/** Longer than any line the strip can show: the rest is cut with an ellipsis. */
const DETAIL_MAX = 200;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX);

/** The strip's line for an activity. Tool names show as they come. */
export const activityLine = (activity: WorkerActivity): ActivityLine => {
  if (activity.kind === 'background') {
    const tasks = activity.count === 1 ? 'background task' : 'background tasks';
    return { label: `${activity.count} ${tasks} running`, detail: '', thinking: false };
  }
  const { entry } = activity;
  switch (entry._tag) {
    case 'thinking':
      return { label: 'Thinking', detail: oneLine(entry.summary), thinking: true };
    case 'toolCall':
      return { label: entry.name, detail: shortInput(entry.input), thinking: false };
    case 'text':
      return { label: 'Writing', detail: oneLine(entry.text), thinking: false };
    case 'status':
      return { label: oneLine(entry.text), detail: '', thinking: false };
  }
};
