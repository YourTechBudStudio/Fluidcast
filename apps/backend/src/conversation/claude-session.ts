/**
 * Reading a stored Claude Code session for Continue: the effort it last ran with. Its last answer
 * comes from the worker's attach, so one rule reads it.
 */
import { Effect, FileSystem, Path, Result, Schema } from 'effect';

import { ClaudeEffort } from './config.ts';

type Block = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Block => typeof value === 'object' && value !== null;

/** Why no effort was recorded for a session. */
export type EffortMissing = 'NoFile' | 'Unreadable' | 'NoAssistantLine' | 'NoEffort';

const isEffort = Schema.is(ClaudeEffort);

/** The line parsed as JSON, or `undefined` when it does not parse. */
const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

/**
 * The top-level `effort` on the last assistant line of
 * `<claudeConfigDir>/projects/<project>/<sessionId>.jsonl`. `getSessionMessages` drops this field,
 * so the raw file is read, whole: acceptable for a one-off read at start. Unparsable lines are
 * skipped.
 */
export const recordedEffort = (
  claudeConfigDir: string,
  sessionId: string,
): Effect.Effect<
  Result.Result<ClaudeEffort, EffortMissing>,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projects = path.join(claudeConfigDir, 'projects');
    const entries = yield* fs.readDirectory(projects).pipe(Effect.orElseSucceed(() => []));
    let file: string | undefined;
    for (const entry of entries) {
      const candidate = path.join(projects, entry, `${sessionId}.jsonl`);
      if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
        file = candidate;
        break;
      }
    }
    if (file === undefined) return Result.fail('NoFile' as const);
    const text = yield* fs.readFileString(file).pipe(Effect.option);
    if (text._tag === 'None') return Result.fail('Unreadable' as const);
    const lines = text.value.split('\n');
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = parseLine(lines[index]!);
      if (!isRecord(line) || line['type'] !== 'assistant') continue;
      const effort = line['effort'];
      return isEffort(effort) ? Result.succeed(effort) : Result.fail('NoEffort' as const);
    }
    return Result.fail('NoAssistantLine' as const);
  });
