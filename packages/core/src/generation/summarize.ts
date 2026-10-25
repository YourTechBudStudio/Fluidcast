import { Effect, Stream } from 'effect';
import { LanguageModel } from 'effect/ai';

import type { Action } from '../actions/index.ts';
import type { GenerationError } from './errors.ts';
import { textOf, toProviderError } from './generate.ts';
import { renderHistory } from './history.ts';
import type { ToolDefinition } from './tools.ts';

/**
 * A neutral summary prompt, for configurations without a preset's. Prose only, so the voice never
 * reads a summary shaped like its own output.
 */
export const defaultSummaryPrompt = `You keep the running memory of a voice conversation between a listener and a voice that presents an agent's work. You receive the previous summary, if any, and the conversation since it, and you write one new summary that replaces both.

Write plain prose in the third person ("the listener", "the voice"). Never write JSON, XML, or anything shaped like the voice's actions.

Keep the listener's own words verbatim in quotes, what they decided, corrected or still asked, and briefly what the voice explained and showed. Drop filler and repetition. Aim for about 4,000 characters; when everything does not fit, compress the oldest material first, never the listener's words.`;

export interface SummarizeOptions {
  /** The system prompt: `defaultSummaryPrompt`, or a preset's. */
  readonly prompt: string;
  /** The summary this one replaces. Absent: the history starts at the beginning. */
  readonly previous?: string;
  /** The actions to fold in, oldest first, as the caller's view gives them. */
  readonly history: ReadonlyArray<Action>;
  /** The configured tools, as for `generate`: results render with them. */
  readonly tools: ReadonlyArray<ToolDefinition>;
}

/**
 * Summarizes conversation history into prose, statelessly. The history is rendered as the voice
 * reads it (`renderHistory`), each message labelled by who it came from, after the previous summary
 * in its own section. Returns the model's text, trimmed, accepted as written. Streamed, like
 * `generate`: some OpenAI-compatible servers send non-streaming replies their client rejects.
 */
export const summarize = (
  options: SummarizeOptions,
): Effect.Effect<string, GenerationError, LanguageModel.LanguageModel> =>
  Effect.suspend(() => {
    const transcript = renderHistory(options.history, options.tools)
      .map(
        (message) =>
          `${message.role === 'user' ? 'Listener side' : 'Voice'}:\n${String(message.content)}`,
      )
      .join('\n\n');
    const sections = [
      ...(options.previous === undefined
        ? []
        : [`<previous_summary>\n${options.previous}\n</previous_summary>`]),
      `<conversation>\n${transcript}\n</conversation>`,
    ];
    return LanguageModel.streamText({
      prompt: [
        { role: 'system', content: options.prompt },
        { role: 'user', content: sections.join('\n\n') },
      ],
    }).pipe(
      Stream.mapError(toProviderError),
      Stream.flatMap(textOf),
      Stream.mkString,
      Effect.map((text) => text.trim()),
    );
  });
