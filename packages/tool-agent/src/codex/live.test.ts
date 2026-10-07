/// <reference types="node" />
/**
 * Opt-in live smoke test against the installed, logged-in `codex`: `FLUIDCAST_CODEX_LIVE=1` runs one
 * tiny turn; `FLUIDCAST_CODEX_LIVE=subagents` also asks for one subagent. Skipped by default, so
 * never part of `pnpm check`. It works in a temporary git repository outside this one, and every
 * app-server it starts is closed by its scope before the test ends.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { Effect, Queue, Stream } from 'effect';

import type { WorkerEvent, WorkerMessage } from '../worker.ts';
import { codexWorker, readCodexThread } from './index.ts';

const live = process.env['FLUIDCAST_CODEX_LIVE'];

const tempRepo = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'fluidcast-codex-live-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};

/** Runs one worker until its first `Settled`, then closes it. */
const turn = (text: string) =>
  Effect.gen(function* () {
    const worker = codexWorker({ cwd: tempRepo(), effort: 'low' });
    const inbox = yield* Queue.unbounded<WorkerMessage>();
    yield* Queue.offer(inbox, { id: crypto.randomUUID(), text });
    const events = yield* worker
      .connect({ cwd: worker.cwd, resume: undefined }, Stream.fromQueue(inbox))
      .pipe(
        Stream.takeUntil((event) => event._tag === 'Settled'),
        Stream.runCollect,
        Effect.timeout('3 minutes'),
      );
    return { worker, events: events as ReadonlyArray<WorkerEvent> };
  });

const sessionOf = (events: ReadonlyArray<WorkerEvent>) => {
  const started = events.find((event) => event._tag === 'SessionStarted');
  assert.ok(started?._tag === 'SessionStarted');
  return started.sessionId;
};

describe(
  'codex live',
  { skip: live === undefined ? 'set FLUIDCAST_CODEX_LIVE to run' : false },
  () => {
    it('runs one tiny turn, settles, and reads it back', { timeout: 300_000 }, async () => {
      const { worker, events } = await Effect.runPromise(turn('Reply with exactly the word: pong'));
      console.log(JSON.stringify(events));
      const sessionId = sessionOf(events);
      assert.ok(events.some((event) => event._tag === 'Consumed'));
      assert.ok(
        events.some(
          (event) =>
            event._tag === 'Entry' && event.entry._tag === 'text' && /pong/i.test(event.entry.text),
        ),
      );
      assert.ok(
        events.some(
          (event) =>
            event._tag === 'Entry' &&
            event.entry._tag === 'turnEnd' &&
            event.entry.outcome === 'success',
        ),
      );
      const attached = await Effect.runPromise(worker.attach(sessionId));
      console.log(JSON.stringify(attached));
      assert.ok(attached.history.some((entry) => entry._tag === 'prompt'));
      const stored = await Effect.runPromise(readCodexThread(sessionId));
      console.log(JSON.stringify(stored));
      assert.match(stored.lastAnswer ?? '', /pong/i);
    });

    it(
      'waits for a subagent and nests it, live and stored',
      {
        timeout: 300_000,
        skip: live === 'subagents' ? false : 'set FLUIDCAST_CODEX_LIVE=subagents',
      },
      async () => {
        const { worker, events } = await Effect.runPromise(
          turn(
            'Spawn exactly one subagent with the prompt "Reply with exactly the word: pong" and wait for it. Then reply with exactly: done',
          ),
        );
        console.log(JSON.stringify(events));
        const sessionId = sessionOf(events);
        const nested = events.filter(
          (event) => event._tag === 'Entry' && event.entry.parentToolUseId !== null,
        );
        assert.ok(nested.length > 0, 'subagent entries');
        const attached = await Effect.runPromise(worker.attach(sessionId));
        console.log(JSON.stringify(attached));
        assert.ok(attached.history.some((entry) => entry.parentToolUseId !== null));
      },
    );
  },
);
