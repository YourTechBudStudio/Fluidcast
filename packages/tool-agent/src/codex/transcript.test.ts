import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { maxContentLength } from '../content.ts';
import { agentMessage, command, main, reasoning, spawn, userMessage } from './frames.test.ts';
import { itemOf } from './protocol.ts';
import {
  completedEntries,
  historyEntries,
  lastAnswer,
  toolCall,
  toolResult,
} from './transcript.ts';

const item = (value: unknown) => {
  const decoded = itemOf(value);
  assert.ok(decoded !== undefined);
  return decoded;
};

describe('tool items', () => {
  it('maps a command to its call and output, an error on a non-zero exit or failed status', () => {
    const ok = item(command('cmd'));
    assert.deepEqual(toolCall(ok, null), {
      _tag: 'toolCall',
      parentToolUseId: null,
      toolUseId: 'cmd',
      name: 'commandExecution',
      input: '{"command":"ls","cwd":"/work"}',
      truncated: false,
    });
    assert.deepEqual(toolResult(ok, null), {
      _tag: 'toolResult',
      parentToolUseId: null,
      toolUseId: 'cmd',
      content: 'a.txt',
      truncated: false,
      isError: false,
    });
    const exit = (value: unknown) => {
      const entry = toolResult(item(value), null);
      return entry._tag === 'toolResult' && entry.isError;
    };
    assert.equal(exit(command('cmd', { exitCode: 2 })), true);
    assert.equal(exit(command('cmd', { status: 'declined', exitCode: null })), true);
    assert.equal(exit(command('cmd', { status: 'failed', exitCode: null })), true);
  });

  it('maps file changes, MCP, dynamic tool, web search, image and subagent calls', () => {
    const cases: ReadonlyArray<readonly [unknown, string, string, string, boolean]> = [
      [
        {
          type: 'fileChange',
          id: 'f',
          status: 'completed',
          changes: [{ path: 'a.ts', kind: { type: 'update', move_path: null }, diff: '+x' }],
        },
        'fileChange',
        '{"changes":[{"path":"a.ts","kind":"update"}]}',
        '+x',
        false,
      ],
      [
        {
          type: 'mcpToolCall',
          id: 'm',
          server: 'docs',
          tool: 'search',
          status: 'completed',
          arguments: { q: 'x' },
          result: { content: [{ type: 'text', text: 'hit' }], structuredContent: null },
          error: null,
        },
        'mcp:docs/search',
        '{"q":"x"}',
        'hit',
        false,
      ],
      [
        {
          type: 'mcpToolCall',
          id: 'm',
          server: 'docs',
          tool: 'search',
          status: 'failed',
          arguments: {},
          result: null,
          error: { message: 'no server' },
        },
        'mcp:docs/search',
        '{}',
        'no server',
        true,
      ],
      [
        {
          type: 'dynamicToolCall',
          id: 'd',
          namespace: null,
          tool: 'lookup',
          arguments: { id: 1 },
          status: 'completed',
          contentItems: [{ type: 'inputText', text: 'found' }],
          success: true,
        },
        'dynamicToolCall',
        '{"namespace":null,"tool":"lookup","arguments":{"id":1}}',
        'found',
        false,
      ],
      [
        { type: 'webSearch', id: 'w', query: 'effect', action: null, results: null },
        'webSearch',
        '{"query":"effect","action":null}',
        '',
        false,
      ],
      [
        { type: 'imageView', id: 'i', path: '/work/a.png' },
        'imageView',
        '{"path":"/work/a.png"}',
        '',
        false,
      ],
      [
        {
          ...spawn('s', ['thread-child']),
          agentsStates: { 'thread-child': { status: 'completed', message: 'All good.' } },
        },
        'collabAgentToolCall',
        '{"tool":"spawnAgent","receiverThreadIds":["thread-child"],"prompt":"Explore.","model":"invented-model","reasoningEffort":"medium"}',
        'thread-child: completed\nAll good.',
        false,
      ],
    ];
    for (const [value, name, input, content, isError] of cases) {
      const decoded = item(value);
      const call = toolCall(decoded, 'parent');
      const result = toolResult(decoded, 'parent');
      assert.deepEqual(call._tag === 'toolCall' && [call.name, call.input], [name, input], name);
      assert.deepEqual(
        result._tag === 'toolResult' && [result.content, result.isError, result.parentToolUseId],
        [content, isError, 'parent'],
        name,
      );
    }
  });

  it('caps long inputs and results', () => {
    const long = item(command('cmd', { output: 'x'.repeat(maxContentLength + 5) }));
    const result = toolResult(long, null);
    assert.equal(result._tag === 'toolResult' && result.content.length, maxContentLength);
    assert.equal(result._tag === 'toolResult' && result.truncated, true);
  });
});

describe('itemOf', () => {
  it('decodes reasoning with string content, and keeps the identity of an item it cannot read', () => {
    assert.equal(itemOf(reasoning())?.type, 'reasoning');
    assert.deepEqual(completedEntries(item(reasoning()), null, true), []);
    assert.deepEqual(itemOf({ type: 'commandExecution', id: 'cmd', exitCode: 'not a number' }), {
      type: 'commandExecution',
      id: 'cmd',
    });
    assert.equal(itemOf({ id: 'no type' }), undefined);
  });
});

describe('completedEntries', () => {
  it('maps text, plans and compaction; skips reasoning; prompts only from stored history', () => {
    assert.deepEqual(completedEntries(item(agentMessage('Hi.')), null, false), [
      { _tag: 'text', parentToolUseId: null, text: 'Hi.' },
    ]);
    assert.deepEqual(
      completedEntries(item({ type: 'plan', id: 'p', text: '1. Read' }), null, false),
      [{ _tag: 'status', parentToolUseId: null, text: '1. Read' }],
    );
    assert.deepEqual(completedEntries(item({ type: 'contextCompaction', id: 'c' }), null, false), [
      { _tag: 'status', parentToolUseId: null, text: 'Context compacted.' },
    ]);
    assert.deepEqual(
      completedEntries(
        item({ type: 'reasoning', id: 'r', summary: ['x'], content: [] }),
        null,
        false,
      ),
      [],
    );
    assert.deepEqual(completedEntries(item(userMessage('m1', 'Go.')), null, false), []);
    assert.deepEqual(completedEntries(item(userMessage(null, 'Go.')), null, true), [
      { _tag: 'prompt', parentToolUseId: null, source: 'earlier', text: 'Go.' },
    ]);
  });
});

describe('historyEntries', () => {
  it('nests each subagent thread, recursively, between its spawn call and result', () => {
    const threads = new Map([
      [
        main,
        [userMessage(null, 'Start.'), spawn('call-a', ['thread-a']), agentMessage('Done.')].map(
          item,
        ),
      ],
      ['thread-a', [userMessage(null, 'Explore.'), spawn('call-b', ['thread-b'])].map(item)],
      ['thread-b', [agentMessage('Deep.')].map(item)],
    ]);
    const entries = historyEntries(main, threads).map((entry) => [
      entry._tag,
      entry.parentToolUseId,
    ]);
    assert.deepEqual(entries, [
      ['prompt', null],
      ['toolCall', null],
      ['prompt', 'call-a'],
      ['toolCall', 'call-a'],
      ['text', 'call-b'],
      ['toolResult', 'call-a'],
      ['toolResult', null],
      ['text', null],
    ]);
  });

  it('records no turnEnd and shows a thread named twice once', () => {
    const threads = new Map([
      [main, [spawn('call-a', ['thread-a']), spawn('call-again', ['thread-a'])].map(item)],
      ['thread-a', [agentMessage('Once.')].map(item)],
    ]);
    const texts = historyEntries(main, threads).filter((entry) => entry._tag === 'text');
    assert.deepEqual(texts, [{ _tag: 'text', parentToolUseId: 'call-a', text: 'Once.' }]);
    assert.ok(!historyEntries(main, threads).some((entry) => entry._tag === 'turnEnd'));
  });
});

describe('lastAnswer', () => {
  it('joins the agent messages after the last user message, or is undefined', () => {
    const items = [
      userMessage(null, 'First.'),
      agentMessage('Old.'),
      userMessage(null, 'Second.'),
      agentMessage('One.'),
      command('cmd'),
      agentMessage('Two.'),
    ].map(item);
    assert.equal(lastAnswer(items), 'One.\n\nTwo.');
    assert.equal(lastAnswer([userMessage(null, 'Only.')].map(item)), undefined);
    assert.equal(lastAnswer([]), undefined);
  });
});
