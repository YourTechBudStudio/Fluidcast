import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect, Fiber, Logger, References } from 'effect';
import { TestClock } from 'effect/testing';

import { SkillsUnavailable } from '../worker.ts';
import { fakeServer } from './frames.test.ts';
import { listSkillsWith } from './skills.ts';

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

/** Runs `effect` and returns its failure and the annotations of each warning it logged. */
const withWarnings = <A, E>(effect: Effect.Effect<A, E>) => {
  const logged: Array<Readonly<Record<string, unknown>>> = [];
  const capture = Logger.make((options) => {
    if (options.logLevel === 'Warn') {
      logged.push(options.fiber.getRef(References.CurrentLogAnnotations));
    }
  });
  return Effect.flip(effect).pipe(
    Effect.provide(Logger.layer([capture])),
    Effect.map((failure) => ({ failure, logged })),
  );
};

/** A server that answers `initialize`, and `skills/list` with `list` (pending when undefined). */
const skillsServer = (list: { result: unknown } | { error: unknown } | undefined) =>
  fakeServer(({ method }) =>
    method === 'initialize' ? { result: {} } : method === 'skills/list' ? list : undefined,
  );

describe('listSkillsWith (Codex)', () => {
  it("lists the directory's enabled skills after initialize, and closes the app-server", () =>
    run(
      Effect.gen(function* () {
        const server = yield* skillsServer({
          result: {
            data: [
              {
                cwd: '/work',
                errors: [],
                skills: [
                  { name: 'designing-ui', description: 'Mockups.', enabled: true, path: '/a' },
                  { name: 'old', description: 'Disabled.', enabled: false, path: '/b' },
                  { name: 'shaping-issues', description: 'Shape.', enabled: true, path: '/c' },
                ],
              },
            ],
          },
        });
        assert.deepEqual(yield* listSkillsWith(server.open)('/work'), [
          { name: 'designing-ui', description: 'Mockups.' },
          { name: 'shaping-issues', description: 'Shape.' },
        ]);
        assert.deepEqual(
          server.written.map((message) => message['method']),
          ['initialize', 'initialized', 'skills/list'],
        );
        assert.deepEqual(server.requests('skills/list')[0]?.['params'], { cwds: ['/work'] });
        assert.equal(server.state.released, 1);
      }),
    ));

  it("fails with SkillsUnavailable, logging Codex's message or only the tag", () =>
    run(
      Effect.gen(function* () {
        const refused = yield* skillsServer({ error: { code: -32600, message: 'no skills' } });
        assert.deepEqual(yield* withWarnings(listSkillsWith(refused.open)('/work')), {
          failure: new SkillsUnavailable({ reason: 'Failed' }),
          logged: [
            { error: 'RpcFailure', method: 'skills/list', code: -32600, message: 'no skills' },
          ],
        });
        assert.equal(refused.state.released, 1);

        const malformed = yield* skillsServer({
          result: { data: [{ skills: [{ secret: 'x' }] }] },
        });
        const { failure, logged } = yield* withWarnings(listSkillsWith(malformed.open)('/work'));
        assert.deepEqual(failure, new SkillsUnavailable({ reason: 'Failed' }));
        assert.deepEqual(
          logged.map((annotations) => Object.keys(annotations)),
          [['error']],
        );
      }),
    ));

  it('times out after 10 seconds as TimedOut, closing the app-server', () =>
    run(
      Effect.gen(function* () {
        const server = yield* skillsServer(undefined);
        const fiber = yield* Effect.forkChild(Effect.flip(listSkillsWith(server.open)('/work')));
        yield* TestClock.adjust('10 seconds');
        assert.deepEqual(yield* Fiber.join(fiber), new SkillsUnavailable({ reason: 'TimedOut' }));
        assert.equal(server.state.released, 1);
      }).pipe(Effect.provide(TestClock.layer())),
    ));
});
