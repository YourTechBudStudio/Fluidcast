import { Schema } from 'effect';

import { SpeakerProfile } from '@yourtechbudstudio/fluidcast-core/actions';
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
  /** Integrator instructions placed in the system prompt. */
  readonly instructions: string;
  readonly speakers: SessionSpeakers;
  /** The audio format `speech` produces. */
  readonly speechFormat: AudioFormat;
  /** The tools the model may call, in prompt order. Pass `[]` for a speech-only session. */
  readonly tools: ReadonlyArray<Tool>;
}
