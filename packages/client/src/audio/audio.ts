import { Effect, FiberMap, Stream } from 'effect';

import type { SpeechNotFound, SessionState } from '@yourtechbudstudio/fluidcast-harness/protocol';
import { currentAction } from '@yourtechbudstudio/fluidcast-harness/protocol';

import type { Transport, TransportError } from '../transport.ts';
import type { AudioStore } from './store.ts';

/** How many speaks after the cursor are prefetched. */
export const prefetchWindow = 3;

/** Audio the application can play: complete bytes, or a URL to stream from. No DOM types. */
export type Playable =
  | { readonly bytes: Uint8Array; readonly mimeType: string }
  | { readonly url: string };

/**
 * Prefetching and caching (client-integration.md). Prefetch only fetches: playback is authorised by
 * the Harness's `PlaybackRequested` alone.
 */
export const makeAudio = (transport: Transport['Service'], store: AudioStore) =>
  Effect.gen(function* () {
    const prefetches = yield* FiberMap.make<string, void>();

    const download = (actionId: string) =>
      Stream.runCollect(transport.speech(actionId)).pipe(Effect.map(concat));

    /**
     * Fits cache and downloads to the state: prefetches the next speaks after the cursor as soon as
     * they are known, keeps the speak at the cursor, and cancels or evicts everything else (played,
     * trimmed, or no longer in the log).
     */
    const reconcile = (state: SessionState) =>
      Effect.gen(function* () {
        const ahead = state.actions
          .slice(state.cursor + 1)
          .filter((action) => action.type === 'speak')
          .slice(0, prefetchWindow)
          .map((action) => action.id as string);
        const current = currentAction(state);
        const keep = new Set(current?.type === 'speak' ? [...ahead, current.id] : ahead);

        for (const [actionId] of [...prefetches]) {
          if (!keep.has(actionId)) yield* FiberMap.remove(prefetches, actionId);
        }
        for (const actionId of yield* store.keys) {
          if (!keep.has(actionId)) yield* store.remove(actionId);
        }
        for (const actionId of ahead) {
          if ((yield* store.get(actionId)) !== undefined) continue;
          yield* FiberMap.run(
            prefetches,
            actionId,
            // A failed prefetch is dropped: the playback path fetches the line again.
            download(actionId).pipe(
              Effect.flatMap((bytes) => store.set(actionId, bytes)),
              Effect.ignore,
            ),
            { onlyIfMissing: true },
          );
        }
      });

    /**
     * Audio for a line about to play. Cached bytes when complete; otherwise only this line's
     * prefetch is cancelled and it is streamed from `speechUrl`, or downloaded completely.
     */
    const playable = (
      actionId: string,
      mimeType: string,
    ): Effect.Effect<Playable, SpeechNotFound | TransportError> =>
      Effect.gen(function* () {
        const cached = yield* store.get(actionId);
        if (cached !== undefined) return { bytes: cached, mimeType };
        yield* FiberMap.remove(prefetches, actionId);
        if (transport.speechUrl !== undefined) return { url: transport.speechUrl(actionId) };
        const bytes = yield* download(actionId);
        yield* store.set(actionId, bytes);
        return { bytes, mimeType };
      });

    /** Cancels every download, for a session that will not play again. */
    const cancelAll = FiberMap.clear(prefetches);

    return { reconcile, playable, cancelAll };
  });

const concat = (chunks: Iterable<Uint8Array>): Uint8Array => {
  const parts = [...chunks];
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};
