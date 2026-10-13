import { Context, Effect, Exit, Fiber, Layer, Stream } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { Transport, TransportError } from '@yourtechbudstudio/fluidcast-client';

import { type ScriptedSession, scriptedSession, speak } from './support/session';

// The DOM fixture's controls, checked on their own: phase 03's gate tests rely on them opening exactly these windows.

const sessions: Array<ScriptedSession> = [];
afterEach(async () => {
  for (const created of sessions.splice(0)) await created.close();
});

const transportOf = (s: ScriptedSession) =>
  Effect.map(Layer.build(s.connection()), (context) => Context.get(context, Transport));

const fixture = async () => {
  const created = await scriptedSession([[speak('A.')]]);
  sessions.push(created);
  return created;
};

describe('scripted session fixture', () => {
  it('fails a chosen command, records it, and recovers when cleared', async () => {
    const s = await fixture();
    s.failSend('Pause', new TransportError({ reason: 'Unreachable' }));
    const failed = await Effect.runPromiseExit(
      Effect.scoped(Effect.flatMap(transportOf(s), (t) => t.send({ _tag: 'Pause' }))),
    );
    expect(Exit.isFailure(failed)).toBe(true);
    s.failSend('Pause', null);
    await Effect.runPromise(
      Effect.scoped(Effect.flatMap(transportOf(s), (t) => t.send({ _tag: 'Pause' }))),
    );
    expect(s.tags()).toEqual(['Pause', 'Pause']);
  });

  it('holds a chosen command unresolved until released', async () => {
    const s = await fixture();
    const hold = s.holdSend('Pause');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* transportOf(s);
          const fiber = yield* Effect.forkChild(transport.send({ _tag: 'Pause' }));
          yield* Effect.sleep('20 millis');
          expect(fiber.pollUnsafe()).toBeUndefined();
          expect(s.tags()).toEqual(['Pause']);
          hold.release();
          yield* Fiber.join(fiber);
        }),
      ),
    );
  });

  it('holds the construction of connections made while held', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Effect.promise(fixture);
          const latch = s.holdConstruction();
          const fiber = yield* Effect.forkChild(transportOf(s));
          yield* Effect.sleep('20 millis');
          expect(fiber.pollUnsafe()).toBeUndefined();
          latch.release();
          yield* Fiber.join(fiber);
        }),
      ),
    );
  });

  it('keeps a turn generating while the model is held, and can start with a preloaded message', async () => {
    const s = await scriptedSession([[speak('A.')]], {
      start: { message: 'Begin.', context: { label: 'Brief', text: 'Notes.' } },
    });
    sessions.push(s);
    const generating = s.holdModel();
    await s.drive({ _tag: 'Start' });
    const spoken = () => s.relayed.some(({ message }) => message._tag === 'PlaybackRequested');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* transportOf(s);
          yield* Effect.forkChild(Stream.runDrain(transport.subscribe()));
          yield* Effect.sleep('30 millis');
          expect(spoken()).toBe(false);
          generating.release();
          yield* Effect.sleep('30 millis');
          expect(spoken()).toBe(true);
        }),
      ),
    );
  });
});
