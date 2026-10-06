import { Schema } from 'effect';

import { SpeakerProfile } from '@yourtechbudstudio/fluidcast-core/actions';
import type { Example, Reminders } from '@yourtechbudstudio/fluidcast-core/generation';
import { Voice, type AudioFormat } from '@yourtechbudstudio/fluidcast-core/speech';

import type { Tool } from '../tool.ts';

/**
 * A configured speaker: who it is and how it talks (Core's prompt profile), held together with how it sounds.
 * The Harness passes the profile to generation and the voice to synthesis.
 */
export const SessionSpeaker = Schema.Struct({ ...SpeakerProfile.fields, voice: Voice });
export type SessionSpeaker = typeof SessionSpeaker.Type;

/** The session's speakers, the first being the lead. IDs are unique: actions refer to speakers by ID. */
export const SessionSpeakers = Schema.NonEmptyArray(SessionSpeaker).check(
  Schema.makeFilter((speakers) => new Set(speakers.map(({ id }) => id)).size === speakers.length, {
    expected: 'speakers with unique ids',
  }),
);
export type SessionSpeakers = typeof SessionSpeakers.Type;

export interface SessionConfig {
  /** The voice's instructions, first in the system prompt: normally a preset's. */
  readonly instructions: string;
  /**
   * Integrator worked examples for the system prompt, after the output format. Each may use only
   * the configured `tools`: one that does not fit them is a configuration defect, and building the
   * session throws.
   */
  readonly examples?: ReadonlyArray<Example>;
  readonly speakers: SessionSpeakers;
  /** The audio format `speech` produces. */
  readonly speechFormat: AudioFormat;
  /** The tools the model may call, in prompt order. Pass `[]` for a speech-only session. */
  readonly tools: ReadonlyArray<Tool>;
  /**
   * Reminders for the newest input, passed to generation (Core's `Reminders`), normally a preset's.
   * Tools supply none. Absent: no reminders.
   */
  readonly reminders?: Reminders;
}
