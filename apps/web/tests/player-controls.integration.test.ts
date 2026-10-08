import { Context, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { describe, expect, it } from 'vitest';

import { Client, layer as clientLayer, Transport } from '@yourtechbudstudio/fluidcast-client';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { layer as sessionLayer, Session, type Tool } from '@yourtechbudstudio/fluidcast-harness';
import type { ExecutionId } from '@yourtechbudstudio/fluidcast-harness/protocol';
import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';
import { ShowCommand } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { fakeMedia } from '../src/playback/fakeMedia';
import { makePlayer } from '../src/playback/player';

/**
 * The whole boundary, provider-free: a real Harness session (scripted model, the real Show tool and a controlled tool
 * that is not replayed), the real Client over an in-memory transport, and the real player over a fake element.
 */

// One scripted reply: Speech A, a Show, a call that is never replayed, then Speech B and Speech C.
const line = (text: string) => ({ type: 'speak', speaker: 'host', text });
const REPLY = JSON.stringify([
  line('A.'),
  { type: 'show', format: 'markdown', content: '# Layers' },
  { type: 'note', label: 'once' },
  line('B.'),
  line('C.'),
]);

const scriptedModel = LanguageModel.make({
  generateText: () => Effect.die('unused'),
  streamText: () => Stream.make({ type: 'text-delta', id: 't', delta: REPLY } as const),
});

/** Like a worker handoff: it runs once, and forward replay never runs it again. */
const noteTool = (runs: { count: number }): Tool<{ readonly label: string }, object> => ({
  name: 'note',
  input: Schema.Struct({ label: Schema.String }),
  guidelines: ['Use `note`.'],
  result: Schema.Struct({}),
  renderResult: () => 'Noted.',
  policy: { blocking: false, response: 'none', replay: false },
  run: () => Effect.sync(() => void runs.count++).pipe(Effect.as({})),
});

const synthesizer = SpeechSynthesizer.of({
  synthesize: (request) => Stream.make(new TextEncoder().encode(request.text)),
});

/** The application's transport, in memory: commands and audio go straight to the session. */
const memoryTransport = Layer.effect(
  Transport,
  Effect.map(Effect.service(Session), (session) =>
    Transport.of({
      subscribe: () => session.subscribe(),
      send: (command) => session.command(command),
      speech: (actionId) => session.speech(actionId),
    }),
  ),
);

/** Polls `effect` until `done` holds, dying after two seconds. */
const eventually = <A>(effect: Effect.Effect<A>, done: (value: A) => boolean, what: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 400; attempt++) {
      const value = yield* effect;
      if (done(value)) return value;
      yield* Effect.sleep('5 millis');
    }
    return yield* Effect.die(new Error(`not reached: ${what}`));
  });

describe('player controls across the Harness, Client and player', () => {
  it('pauses A, steps silently through a Show to B and C, plays C, and replays by each tool’s policy', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runs = { count: 0 };
          const model = yield* scriptedModel;
          const harness = sessionLayer({
            instructions: 'Be brief.',
            speakers: [
              { id: 'host', name: 'Host', personality: 'Warm.', voice: { name: 'alloy' } },
            ],
            speechFormat: 'opus',
            tools: [showTool(), noteTool(runs)],
          }).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(LanguageModel.LanguageModel, model),
                Layer.succeed(SpeechSynthesizer, synthesizer),
              ),
            ),
          );
          const context = yield* Layer.build(
            clientLayer().pipe(Layer.provide(memoryTransport), Layer.provideMerge(harness)),
          );
          const client = Context.get(context, Client);
          const fake = fakeMedia();
          const player = yield* makePlayer(fake.media).pipe(Effect.provide(context));

          const view = Effect.map(client.view.get, Option.getOrThrow);
          const status = SubscriptionRef.get(player.status);
          const presentedText = Effect.map(view, (v) => v.presented?.text);
          const showExecutions = Effect.map(view, (v) =>
            v.executions.filter((e) => e.tool === 'show').map((e) => e.executionId),
          );
          /** Reports the open Show as rendered, as the page's Show driver does; the Harness must accept it. */
          const reportShows = (seen: Set<ExecutionId>) =>
            Effect.gen(function* () {
              const open = (yield* view).executions.filter(
                (e) => e.tool === 'show' && !seen.has(e.executionId),
              );
              for (const execution of open) {
                seen.add(execution.executionId);
                yield* client.sendToolCommand(
                  ShowCommand,
                  { handle: execution.handles[0], executionId: execution.executionId },
                  { rendered: true },
                );
              }
              return open.length;
            });

          // Speech A plays.
          yield* eventually(client.connection.get, (c) => c === 'connected', 'connected');
          yield* client.sendMessage('Walk me through it.');
          yield* eventually(status, (s) => s.kind === 'playing', 'A playing');
          expect(yield* presentedText).toBe('A.');
          expect(fake.element.plays).toBe(1);

          // Pause A: the clip stays loaded.
          yield* client.pause();
          yield* eventually(status, (s) => s.kind === 'paused', 'A paused');
          expect(fake.element.src).toBe('blob:1');
          expect(fake.revoked).toEqual([]);

          // Forward: the Show and the note run, B is selected silently, A's clip is freed.
          yield* client.next();
          yield* eventually(presentedText, (text) => text === 'B.', 'B selected');
          expect((yield* view).paused).toBe(true);
          const seen = new Set<ExecutionId>();
          yield* eventually(showExecutions, (ids) => ids.length === 1, 'Show running');
          expect(yield* reportShows(seen)).toBe(1);
          yield* eventually(showExecutions, (ids) => ids.length === 0, 'Show reported');
          expect(runs.count).toBe(1);
          yield* eventually(Effect.succeed(fake.revoked), (r) => r.length === 1, 'A freed');
          expect(Option.isNone(yield* client.playback.get)).toBe(true);
          expect(fake.element.plays).toBe(1);

          // Forward again: C, still silent.
          yield* client.next();
          yield* eventually(presentedText, (text) => text === 'C.', 'C selected');
          expect(Option.isNone(yield* client.playback.get)).toBe(true);
          expect(fake.element.plays).toBe(1);

          // Play: C starts from a fresh clip.
          yield* client.play();
          yield* eventually(status, (s) => s.kind === 'playing', 'C playing');
          expect((yield* client.playback.get).pipe(Option.map((i) => i.action.text))).toEqual(
            Option.some('C.'),
          );
          expect(fake.element.sources).toEqual(['blob:1', 'blob:2']);
          expect(fake.element.plays).toBe(2);
          fake.element.end();
          yield* eventually(view, (v) => v.presented === undefined && v.phase === 'idle', 'end');

          // Back three times while paused selects A; Forward replays the Show but never the note.
          yield* client.pause();
          yield* client.back();
          yield* client.back();
          yield* client.back();
          yield* eventually(presentedText, (text) => text === 'A.', 'A replay selected');
          yield* client.next();
          yield* eventually(presentedText, (text) => text === 'B.', 'B replay selected');
          yield* eventually(showExecutions, (ids) => ids.length === 1, 'Show replayed');
          expect(yield* reportShows(seen)).toBe(1);
          expect(seen.size).toBe(2);
          expect(runs.count).toBe(1);
          expect(fake.element.plays).toBe(2);
        }),
      ),
    ));
});
