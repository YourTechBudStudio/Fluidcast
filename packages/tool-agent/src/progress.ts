/**
 * Progress snapshots: while a busy period runs, a schedule asks a language model for one sentence
 * describing the worker's recent transcript and offers it to the Harness, which accepts (uses or keeps) or drops it.
 */
import { Effect, Ref, Schedule, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import type { TranscriptEntry } from './schema.ts';

/**
 * Ticks at 10, 20, 30, 45 and 60 s, then 90, 150, 270 s and so on (exponential backoff, base 30 s,
 * factor 2), with no cap.
 */
export const defaultProgressSchedule: Schedule.Schedule<unknown> = Schedule.concat(
  Schedule.spaced('10 seconds').pipe(Schedule.upTo({ times: 3 })),
  Schedule.concat(
    Schedule.spaced('15 seconds').pipe(Schedule.upTo({ times: 2 })),
    Schedule.exponential('30 seconds', 2),
  ),
);

/** How many recent entries a snapshot describes. */
const snapshotEntries = 20;

/**
 * The progress writer's default system prompt: one neutral sentence about the agent's activity. A
 * preset may supply its own.
 */
export const defaultProgressPrompt =
  'Say what an agent is doing right now, for someone listening. Reply with one standalone sentence in the present tense, under 20 words, with no preamble, quotes or markdown. Describe the activity, not the tools.';

/** Entries that say what the worker is doing. Prompts, results and turn ends do not. */
const isActivity = (entry: TranscriptEntry) =>
  entry._tag === 'text' || entry._tag === 'toolCall' || entry._tag === 'status';

const describe = (entry: TranscriptEntry): string => {
  switch (entry._tag) {
    case 'text':
      return entry.text.slice(0, 300);
    case 'toolCall':
      return `${entry.name}(${entry.input.slice(0, 120)})`;
    case 'status':
      return entry.text;
    default:
      return '';
  }
};

/**
 * The reply as one standalone sentence, or `undefined` when it is not one: empty, a line break,
 * fewer than three words, over 200 characters, or more text after a sentence end. Surrounding
 * quotes are stripped and a final `.` added when missing. Nothing is truncated: a cut sentence is
 * a fragment.
 */
export const oneSentence = (reply: string): string | undefined => {
  const text = reply
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .trim();
  if (text === '' || /[\r\n]/.test(text) || text.length > 200) return undefined;
  if (text.split(/\s+/).length < 3) return undefined;
  if (/[.!?]\s+\S/.test(text)) return undefined;
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

/**
 * Runs for as long as its fiber lives (the execution's scope). Each tick skips unless the
 * transcript gained activity since the last *accepted* snapshot, so a dropped or rejected snapshot is
 * retried on the next tick. Model failures are logged by identifiers and skipped, never faults;
 * neither the entries nor the text are logged.
 */
export const progressLoop = (options: {
  readonly schedule: Schedule.Schedule<unknown>;
  /** The system prompt that asks for one sentence (`defaultProgressPrompt`, or a preset's). */
  readonly prompt: string;
  readonly model: LanguageModel.LanguageModel;
  /** Reads the worker's transcript as it is now. */
  readonly transcript: Effect.Effect<ReadonlyArray<TranscriptEntry>>;
  /** The period's first transcript index. */
  readonly start: number;
  readonly offer: (text: string) => Effect.Effect<boolean>;
}): Effect.Effect<void> =>
  Effect.gen(function* () {
    const acceptedUpTo = yield* Ref.make(options.start);
    const failed = (error: string) =>
      Effect.logWarning('worker progress failed').pipe(
        Effect.annotateLogs({ error }),
        Effect.as(undefined),
      );
    const tick = Effect.gen(function* () {
      const entries = yield* options.transcript;
      if (!entries.slice(yield* Ref.get(acceptedUpTo)).some(isActivity)) return;
      const lines = entries
        .slice(options.start)
        .filter(isActivity)
        .slice(-snapshotEntries)
        .map(describe);
      // Streamed, like the voice model's own generation: some OpenAI-compatible servers (vLLM)
      // send non-streaming replies that the compatible client rejects (`service_tier: null`).
      const reply = yield* options.model
        .streamText({
          prompt: [
            { role: 'system', content: options.prompt },
            { role: 'user', content: lines.join('\n') },
          ],
        })
        .pipe(
          Stream.runFold(
            () => '',
            (text, part) => (part.type === 'text-delta' ? text + part.delta : text),
          ),
          Effect.timeout('30 seconds'),
          Effect.map((text): string | undefined => text),
          Effect.catch((error) =>
            failed(error._tag === 'AiError' ? error.reason._tag : error._tag),
          ),
          Effect.catchDefect(() => failed('Defect')),
        );
      const text = reply === undefined ? undefined : oneSentence(reply);
      if (text === undefined) return;
      if (yield* options.offer(text)) yield* Ref.set(acceptedUpTo, entries.length);
    });
    yield* Effect.schedule(tick, options.schedule);
  });
