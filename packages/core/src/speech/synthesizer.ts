import { Context, Effect, Schema, Stream } from 'effect';

/** Audio container formats a synthesizer can produce. */
export const AudioFormat = Schema.Literals(['opus', 'mp3', 'wav']);
export type AudioFormat = typeof AudioFormat.Type;

/** The MIME type to serve each format with. */
export const audioMimeType: Readonly<Record<AudioFormat, string>> = {
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/** Speech synthesis failed. Carries only identifiers, never the text or provider message. */
export class SpeechError extends Schema.TaggedError<SpeechError>()('SpeechError', {
  reason: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

export interface SynthesizeRequest {
  readonly text: string;
  /** The provider's voice for the speaker. */
  readonly voice: string;
  /** Defaults to `opus`. */
  readonly format?: AudioFormat;
  /** Optional delivery guidance for providers that support it. */
  readonly voiceInstructions?: string;
}

/** Turns text into a stream of encoded audio bytes. Implementations are provider layers. */
export class SpeechSynthesizer extends Context.Service<
  SpeechSynthesizer,
  {
    readonly synthesize: (
      request: SynthesizeRequest & { readonly format: AudioFormat },
    ) => Stream.Stream<Uint8Array, SpeechError>;
  }
>()('@yourtechbudstudio/fluidcast-core/SpeechSynthesizer') {}

/** Streams synthesized audio for one line as the provider produces it. */
export const synthesize = (
  request: SynthesizeRequest,
): Stream.Stream<Uint8Array, SpeechError, SpeechSynthesizer> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const synthesizer = yield* SpeechSynthesizer;
      return synthesizer.synthesize({ ...request, format: request.format ?? 'opus' });
    }),
  );
