/**
 * Preloading a stored Claude Code session, with the SDK's session readers as a parameter so it can
 * be driven by synthetic history. Internal: the `./claude` entry builds `claudeWorker` from it.
 */
import type {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSubagents,
} from '@anthropic-ai/claude-agent-sdk';
import { Effect } from 'effect';

import { WorkerSetupError, type Attached } from '../worker.ts';
import { historyEntries, lastAnswer } from './transcript.ts';

/** The SDK's session readers. */
export interface SessionStore {
  readonly getSessionInfo: typeof getSessionInfo;
  readonly getSessionMessages: typeof getSessionMessages;
  readonly listSubagents: typeof listSubagents;
  readonly getSubagentMessages: typeof getSubagentMessages;
}

/**
 * Checks a session exists and reads its directory (its recorded one, else `cwd`), its history,
 * with each earlier subagent nested under its starting call, and its main chain's last answer.
 * Spawns nothing.
 */
export const attachWith =
  (store: SessionStore, cwd: string) =>
  (sessionId: string): Effect.Effect<Attached, WorkerSetupError> =>
    Effect.gen(function* () {
      const read = <A>(promise: () => Promise<A>) =>
        Effect.tryPromise({
          try: promise,
          catch: () => new WorkerSetupError({ sessionId, reason: 'SessionUnreadable' }),
        });
      const info = yield* read(() => store.getSessionInfo(sessionId));
      if (info === undefined) {
        return yield* new WorkerSetupError({ sessionId, reason: 'SessionNotFound' });
      }
      const dir = info.cwd ?? cwd;
      const [main, agentIds] = yield* Effect.all([
        read(() => store.getSessionMessages(sessionId, { dir })),
        read(() => store.listSubagents(sessionId, { dir })),
      ]);
      const subagents = yield* Effect.forEach(agentIds, (agentId) =>
        read(() => store.getSubagentMessages(sessionId, agentId, { dir })).pipe(
          Effect.map((messages) => ({ agentId, messages })),
        ),
      );
      return { cwd: dir, history: historyEntries(main, subagents), lastAnswer: lastAnswer(main) };
    });
