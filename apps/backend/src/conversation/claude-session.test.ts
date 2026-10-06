import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Result } from 'effect';

import { lastAnswer, parseSessionId, recordedEffort } from './claude-session.ts';
import { storedMessage } from './fixtures.test.ts';

const id = '0198f1a2-3b4c-7d5e-8f60-123456789abc';

describe('parseSessionId', () => {
  it('trims a UUID', () => {
    assert.equal(parseSessionId(`  ${id}\n`), id);
  });

  it('rejects anything else', () => {
    for (const text of ['', 'nope', `${id}x`, '../../etc/passwd', `${id} ${id}`]) {
      assert.equal(parseSessionId(text), undefined);
    }
  });
});

describe('lastAnswer', () => {
  const text = (value: string) => ({ type: 'text', text: value });

  it('joins every top-level assistant text since the last prompt with a blank line', () => {
    const answer = lastAnswer([
      storedMessage('user', 'First question'),
      storedMessage('assistant', [text('Old answer.')]),
      storedMessage('user', [text('Second question')]),
      storedMessage('assistant', [text('One.')]),
      storedMessage('assistant', [{ type: 'tool_use', id: 't', name: 'Read', input: {} }]),
      // A tool result is not a prompt, so it does not bound the answer.
      storedMessage('user', [{ type: 'tool_result', tool_use_id: 't', content: 'file' }]),
      storedMessage('assistant', [{ type: 'thinking', thinking: 'hmm' }, text('Two.')]),
    ]);
    assert.equal(answer, 'One.\n\nTwo.');
  });

  it("ignores subagents' text and prompts", () => {
    const answer = lastAnswer([
      storedMessage('user', 'Question'),
      storedMessage('assistant', [text('Mine.')]),
      storedMessage('user', [text('Subagent prompt')], 'task_1'),
      storedMessage('assistant', [text('Subagent text.')], 'task_1'),
    ]);
    assert.equal(answer, 'Mine.');
  });

  it('is undefined when no text follows the last prompt', () => {
    assert.equal(lastAnswer([]), undefined);
    assert.equal(
      lastAnswer([
        storedMessage('assistant', [text('Before.')]),
        storedMessage('user', 'Question'),
        storedMessage('assistant', [
          { type: 'tool_use', id: 't', name: 'Read', input: {} },
          text(''),
        ]),
      ]),
      undefined,
    );
  });
});

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
