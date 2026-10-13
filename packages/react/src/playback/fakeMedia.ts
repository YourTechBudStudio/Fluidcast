import { Effect } from 'effect';

import type { MediaElement, PlayerMedia } from './player';

// Test support: the player's media without a browser, for the player's tests and the integration test. The app never
// imports it.

/** A controllable `<audio>` element: `play()` settles when the test says, and `ended`/`error` fire on demand. */
export class FakeElement extends EventTarget implements MediaElement {
  src = '';
  currentTime = 0;
  /** Every source the element was pointed at, in order. */
  readonly sources: string[] = [];
  plays = 0;
  pauses = 0;
  /** `immediate`: `play()` resolves at once. `manual`: it waits for `settlePlay`. */
  mode: 'immediate' | 'manual' = 'immediate';
  private pending: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  constructor() {
    super();
    return new Proxy(this, {
      set(target, key, value) {
        if (key === 'src' && value !== '') target.sources.push(String(value));
        return Reflect.set(target, key, value);
      },
    });
  }

  play() {
    this.plays++;
    if (this.mode === 'immediate') return Promise.resolve();
    return new Promise<void>((resolve, reject) => this.pending.push({ resolve, reject }));
  }
  /** Settles the oldest pending `play()`. */
  settlePlay(outcome: 'resolve' | DOMException) {
    const next = this.pending.shift();
    if (!next) throw new Error('no pending play()');
    if (outcome === 'resolve') next.resolve();
    else next.reject(outcome);
  }
  pause() {
    this.pauses++;
  }
  load() {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  end() {
    this.dispatchEvent(new Event('ended'));
  }
  fail() {
    this.dispatchEvent(new Event('error'));
  }
}

/** Media over a `FakeElement`, recording what the player does with object URLs and the unlock gesture. */
export function fakeMedia(options: { readonly audible?: boolean } = {}) {
  const element = new FakeElement();
  const revoked: string[] = [];
  let urls = 0;
  let audible = options.audible ?? true;
  let unlocks = 0;
  const media: PlayerMedia = {
    element,
    audible: Effect.sync(() => audible),
    unlock: () => void unlocks++,
    analyser: () => null,
    createObjectUrl: () => `blob:${++urls}`,
    revokeObjectUrl: (url) => void revoked.push(url),
  };
  return {
    media,
    element,
    revoked,
    unlocks: () => unlocks,
    setAudible: (value: boolean) => void (audible = value),
  };
}
