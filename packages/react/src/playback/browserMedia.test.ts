// @vitest-environment happy-dom
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { browserMedia } from './player';

describe('browserMedia', () => {
  it('loads clips with CORS, so a cross-origin clip without it fails visibly instead of playing silently', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.map(browserMedia, (media) =>
          expect((media.element as HTMLAudioElement).crossOrigin).toBe('anonymous'),
        ),
      ),
    ));
});
