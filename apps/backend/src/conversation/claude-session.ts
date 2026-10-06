/**
 * Reading a stored Claude Code session for Continue: the pasted ID, the session's last answer, and
 * the effort it last ran with.
 */
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { Effect, FileSystem, Path, Result, Schema } from 'effect';

import { ClaudeEffort } from './config.ts';

type Block = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Block => typeof value === 'object' && value !== null;

const isUuid = Schema.is(Schema.String.check(Schema.isUUID()));

/** Trimmed; a UUID, or `undefined`. Runs before the ID reaches any reader or path. */
export const parseSessionId = (text: string): string | undefined => {
  const id = text.trim();
  return isUuid(id) ? id : undefined;
};

/** `SessionMessage.message` is `unknown`: its `content`, if it has one. */
const contentOf = (message: SessionMessage): unknown =>
  isRecord(message.message) ? message.message['content'] : undefined;

/** The non-empty `text` blocks of a content array, in order. */
const textsOf = (content: unknown): ReadonlyArray<string> =>
  Array.isArray(content)
    ? content.flatMap((block) =>
        isRecord(block) &&
        block['type'] === 'text' &&
        typeof block['text'] === 'string' &&
        block['text'] !== ''
          ? [block['text']]
          : [],
      )
    : [];

const isTopLevel = (message: SessionMessage) => message.parent_tool_use_id === null;

/**
 * A prompt: a top-level user message whose content is a string, or has a non-empty text block. The
 * rule `claude/transcript.ts` uses, so a user message holding only tool results is not one.
 */
const isPrompt = (message: SessionMessage): boolean => {
  if (message.type !== 'user' || !isTopLevel(message)) return false;
  const content = contentOf(message);
  return typeof content === 'string' || textsOf(content).length > 0;
};

/**
 * Every top-level assistant text since the last top-level prompt, in order, joined with a blank
 * line (as a forward result reads), or `undefined` when there is none. Pure.
 */
export const lastAnswer = (messages: ReadonlyArray<SessionMessage>): string | undefined => {
  const start = messages.findLastIndex(isPrompt);
  const answer = messages
    .slice(start + 1)
    .filter((message) => message.type === 'assistant' && isTopLevel(message))
    .flatMap((message) => textsOf(contentOf(message)))
    .join('\n\n');
  return answer === '' ? undefined : answer;
};

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
