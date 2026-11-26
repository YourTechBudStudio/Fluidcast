import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Result } from 'effect';

import { recordedEffort } from './claude-session.ts';

const id = '0198f1a2-3b4c-7d5e-8f60-123456789abc';

describe('recordedEffort', () => {
  const directories: Array<string> = [];
  after(() => directories.forEach((directory) => rmSync(directory, { recursive: true })));

  /** A Claude config directory holding `lines` as the session's JSONL, or no session file. */
  const effortOf = (lines?: ReadonlyArray<string>) => {
    const config = mkdtempSync(join(tmpdir(), 'fluidcast-claude-'));
    directories.push(config);
    mkdirSync(join(config, 'projects', 'other-project'), { recursive: true });
    if (lines !== undefined) {
      mkdirSync(join(config, 'projects', 'this-project'));
      writeFileSync(join(config, 'projects', 'this-project', `${id}.jsonl`), lines.join('\n'));
    }
    return Effect.runPromise(recordedEffort(config, id).pipe(Effect.provide(NodeServices.layer)));
  };

  const line = (value: Record<string, unknown>) => JSON.stringify(value);

  it("reads the last assistant line's effort, even with user lines after it", async () => {
    const effort = await effortOf([
      line({ type: 'assistant', effort: 'low' }),
      line({ type: 'assistant', effort: 'xhigh' }),
      line({ type: 'user' }),
      '',
    ]);
    assert.deepEqual(effort, Result.succeed('xhigh'));
  });

  it('skips unparsable lines', async () => {
    const effort = await effortOf([line({ type: 'assistant', effort: 'max' }), '{"type": "assi']);
    assert.deepEqual(effort, Result.succeed('max'));
  });

  it('reports NoEffort when the last assistant line has no valid effort', async () => {
    assert.deepEqual(
      await effortOf([line({ type: 'assistant', effort: 'high' }), line({ type: 'assistant' })]),
      Result.fail('NoEffort'),
    );
    assert.deepEqual(
      await effortOf([line({ type: 'assistant', effort: 'turbo' })]),
      Result.fail('NoEffort'),
    );
  });

  it('reports NoAssistantLine and NoFile', async () => {
    assert.deepEqual(await effortOf([line({ type: 'user' })]), Result.fail('NoAssistantLine'));
    assert.deepEqual(await effortOf(), Result.fail('NoFile'));
  });

  it('reports NoFile when the config directory has no projects', async () => {
    const effort = await Effect.runPromise(
      recordedEffort('/nonexistent-claude-config', id).pipe(Effect.provide(NodeServices.layer)),
    );
    assert.deepEqual(effort, Result.fail('NoFile'));
  });
});
