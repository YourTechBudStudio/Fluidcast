import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Options, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { Effect, Fiber, Logger, References } from 'effect';
import { TestClock } from 'effect/testing';

import { SkillsUnavailable } from '../schema.ts';
import { queryOptions } from './connect.ts';
import { listSkillsWith, type CommandsQueryFunction } from './skills.ts';

const workerOptions = { executable: '/usr/local/bin/claude', environment: { HOME: '/home' } };

/** A fake query: `supportedCommands` answers with `commands` (never, when absent). */
const fakeQuery = (commands: () => Promise<Array<SlashCommand>>) => {
  const state = { opened: [] as Array<Options>, closed: 0, sent: false };
  const query: CommandsQueryFunction = ({ prompt, options }) => {
    state.opened.push(options);
    // The input never yields: the query starts no turn.
    void prompt[Symbol.asyncIterator]()
      .next()
      .then(() => {
        state.sent = true;
      });
    return {
      supportedCommands: commands,
      close: () => {
        state.closed++;
      },
    };
  };
  return { query, state };
};

/** Runs `effect` and returns its failure and the annotations of each warning it logged. */
const withWarnings = <A, E>(effect: Effect.Effect<A, E>) => {
  const logged: Array<Readonly<Record<string, unknown>>> = [];
  const capture = Logger.make((options) => {
    if (options.logLevel === 'Warn') {
      logged.push(options.fiber.getRef(References.CurrentLogAnnotations));
    }
  });
  return Effect.runPromise(
    Effect.flip(effect).pipe(
      Effect.provide(Logger.layer([capture])),
      Effect.map((failure) => ({ failure, logged })),
    ),
  );
};

describe('listSkillsWith (Claude)', () => {
  it("lists the worker's skills with its options, built-ins left out, and closes the query", async () => {
    const fake = fakeQuery(async () => [
      { name: 'compact', description: 'Compact.', argumentHint: '', builtin: true },
      { name: 'designing-ui', description: 'Mockups.', argumentHint: '<page>' },
      { name: 'shaping-issues', description: 'Shape.', argumentHint: '' },
    ]);
    const skills = await Effect.runPromise(listSkillsWith(fake.query, workerOptions)('/work'));
    assert.deepEqual(skills, [
      { name: 'designing-ui', description: 'Mockups.', argumentHint: '<page>' },
      { name: 'shaping-issues', description: 'Shape.' },
    ]);
    assert.deepEqual(fake.state.opened, [
      queryOptions(workerOptions, { cwd: '/work', resume: undefined }),
    ]);
    assert.equal(fake.state.closed, 1);
    assert.equal(fake.state.sent, false);
  });

  it('fails with SkillsUnavailable and still closes the query when listing fails', async () => {
    const fake = fakeQuery(() => Promise.reject(new TypeError('secret detail')));
    const { failure, logged } = await withWarnings(
      listSkillsWith(fake.query, workerOptions)('/work'),
    );
    assert.deepEqual(failure, new SkillsUnavailable({ reason: 'Failed' }));
    // Only the error's name, never its message.
    assert.deepEqual(logged, [{ error: 'TypeError' }]);
    assert.equal(fake.state.closed, 1);

    const throwing: CommandsQueryFunction = () => {
      throw new Error('no executable');
    };
    assert.deepEqual(
      (await withWarnings(listSkillsWith(throwing, workerOptions)('/work'))).failure,
      new SkillsUnavailable({ reason: 'Failed' }),
    );
  });

  it('times out after 10 seconds as TimedOut, closing the query', async () => {
    const fake = fakeQuery(() => new Promise(() => {}));
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.flip(listSkillsWith(fake.query, workerOptions)('/work')),
        );
        yield* TestClock.adjust('9 seconds');
        assert.equal(fake.state.closed, 0);
        yield* TestClock.adjust('1 second');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer())),
    );
    assert.deepEqual(failure, new SkillsUnavailable({ reason: 'TimedOut' }));
    assert.equal(fake.state.closed, 1);
  });
});
