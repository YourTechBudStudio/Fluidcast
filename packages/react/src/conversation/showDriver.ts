import type { TransportError } from '@yourtechbudstudio/fluidcast-client';
import type {
  CommandRejected,
  Execution,
  ExecutionId,
  ToolCommandRejected,
} from '@yourtechbudstudio/fluidcast-harness/protocol';
import { forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import { showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

/** The Show driver's decisions, kept pure so they can be pinned by tests. The driver itself is `shows.ts`. */

/** How one attempt to report a Show ended. */
export type ReportOutcome =
  | { readonly _tag: 'Accepted' }
  | CommandRejected
  | ToolCommandRejected
  | TransportError;

/**
 * What the Show driver does next:
 * - `reported`: nothing is left to report. The Harness accepted the report (`accepted`), or the execution had already
 *   closed (`stale`), or the session no longer takes commands (halted);
 * - `unresolved`: sending it again cannot help. The Harness would not accept this report (`invalid`), or the backend
 *   could not accept the request or replied outside the protocol (`BadRequest`, `Malformed`): a well-typed report is
 *   only refused when the page and the backend disagree. The execution stays open;
 * - `retry`: the backend could not be reached, or failed while handling the report. Show the failure and try again
 *   after a backoff.
 */
export type ReportAction =
  | { readonly kind: 'reported'; readonly accepted: boolean }
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'retry'; readonly failure: TransportError };

export function reportActionOf(outcome: ReportOutcome): ReportAction {
  switch (outcome._tag) {
    case 'Accepted':
      return { kind: 'reported', accepted: true };
    case 'CommandRejected':
      return { kind: 'reported', accepted: false };
    case 'ToolCommandRejected':
      return outcome.reason === 'stale'
        ? { kind: 'reported', accepted: false }
        : { kind: 'unresolved' };
    case 'TransportError':
      switch (outcome.reason) {
        case 'BadRequest':
        case 'Malformed':
          return { kind: 'unresolved' };
        case 'Unreachable':
        case 'Closed':
        case 'ServerError':
          return { kind: 'retry', failure: outcome };
      }
  }
}

/** Milliseconds before retry `attempt` (from 0): exponential from 250 ms, capped at 4 s. */
export const retryDelay = (attempt: number): number => Math.min(250 * 2 ** attempt, 4000);

/** What new executions do to the Show panel: open it on a Show, or close it. */
export type PanelChange =
  | { readonly open: true; readonly handle: string }
  | { readonly open: false };

/**
 * The executions that move the Show panel, every one not seen before on this page, in start order (the view keeps
 * executions in start order), and the panel change they add up to. Each Show opens the panel on itself, and each
 * forward closes it, a Show the listener reopened included; when both are new, the later one wins. A replay after
 * Back runs a Show again under a new execution id, so it opens the panel again; a Show only reopened from the
 * transcript never runs, and forwards never replay.
 */
export const panelChanges = (
  executions: ReadonlyArray<Execution>,
  seen: ReadonlySet<ExecutionId>,
): { readonly unseen: ReadonlyArray<ExecutionId>; readonly change: PanelChange | null } => {
  const unseen: ExecutionId[] = [];
  let change: PanelChange | null = null;
  for (const execution of executions) {
    if (seen.has(execution.executionId)) continue;
    if (execution.tool === showToolName) change = { open: true, handle: execution.handles[0] };
    else if (execution.tool === forwardToolName) change = { open: false };
    else continue;
    unseen.push(execution.executionId);
  }
  return { unseen, change };
};
