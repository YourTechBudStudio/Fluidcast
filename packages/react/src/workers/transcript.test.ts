import { describe, expect, it } from 'vitest';

import type { TranscriptEntry } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import {
  instructionPreview,
  shortInput,
  type ToolNode,
  toolState,
  type TranscriptNode,
  transcriptTree,
  turns,
} from './transcript';

const prompt = (text: string, source: 'fluidcast' | 'earlier' = 'fluidcast'): TranscriptEntry => ({
  _tag: 'prompt',
  parentToolUseId: null,
  source,
  text,
});
const text = (value: string, parent: string | null = null): TranscriptEntry => ({
  _tag: 'text',
  parentToolUseId: parent,
  text: value,
});
const toolCall = (id: string, name = 'Bash', parent: string | null = null): TranscriptEntry => ({
  _tag: 'toolCall',
  parentToolUseId: parent,
  toolUseId: id,
  name,
  input: JSON.stringify({ command: `run ${id}` }),
  truncated: false,
});
const toolResult = (
  id: string,
  isError = false,
  parent: string | null = null,
): TranscriptEntry => ({
  _tag: 'toolResult',
  parentToolUseId: parent,
  toolUseId: id,
  content: `out ${id}`,
  truncated: false,
  isError,
});
const status = (value: string, parent: string): TranscriptEntry => ({
  _tag: 'status',
  parentToolUseId: parent,
  text: value,
});
const turnEnd = (outcome = 'success'): TranscriptEntry => ({
  _tag: 'turnEnd',
  parentToolUseId: null,
  outcome,
});

const tools = (nodes: ReadonlyArray<TranscriptNode>) =>
  nodes.filter((node): node is ToolNode => node.kind === 'tool');

describe('transcriptTree', () => {
  it('pairs each call with its result, and never makes a result a node', () => {
    const tree = transcriptTree([
      prompt('Go.'),
      toolCall('t1'),
      text('Looking.'),
      toolResult('t1'),
    ]);
    expect(tree.map((node) => node.kind)).toEqual(['prompt', 'tool', 'text']);
    expect(tools(tree)[0]?.result).toMatchObject({ toolUseId: 't1', content: 'out t1' });
  });

  it('nests a subagent’s entries under the call that started them, and keeps orphans at the top level', () => {
    const tree = transcriptTree([
      toolCall('a1', 'Agent'),
      status('Reading files', 'a1'),
      toolCall('n1', 'Read', 'a1'),
      toolResult('n1', false, 'a1'),
      text('Found it.', 'a1'),
      text('Orphan.', 'gone'),
      toolResult('a1'),
    ]);
    expect(tree.map((node) => node.kind)).toEqual(['tool', 'text']);
    const [agent] = tools(tree);
    expect(agent?.children.map((node) => node.kind)).toEqual(['status', 'tool', 'text']);
    expect(tools(agent?.children ?? [])[0]?.result).toMatchObject({ toolUseId: 'n1' });
    expect(tree[1]).toMatchObject({ kind: 'text', text: 'Orphan.' });
  });
});

describe('toolState', () => {
  const tree = transcriptTree([
    toolCall('t1'),
    toolResult('t1'),
    toolCall('t2'),
    toolResult('t2', true),
    toolCall('t3'),
    toolCall('t4'),
    toolCall('n1', 'Read', 't4'),
  ]);
  const [ok, error, earlier, last] = tools(tree);

  it('reads a result as ok or error', () => {
    expect(toolState(ok!, true)).toBe('ok');
    expect(toolState(error!, true)).toBe('error');
  });

  it('runs only the last unresolved top-level call, and only while the worker works', () => {
    expect(toolState(last!, true)).toBe('running');
    expect(toolState(earlier!, true)).toBe('open');
    expect(toolState(last!, false)).toBe('open');
    expect(toolState(tools(last!.children)[0]!, true)).toBe('open');
  });
});

describe('turns', () => {
  it('ends a turn at its turnEnd, and starts another at a prompt or after an ended turn', () => {
    const all = turns(
      transcriptTree([
        prompt('First.'),
        text('One.'),
        turnEnd(),
        text('An automatic turn.'),
        turnEnd('error_max_turns'),
        prompt('Second.'),
        text('Two.'),
      ]),
    );
    expect(all.map((turn) => [turn.nodes.map((node) => node.kind), turn.end?.outcome])).toEqual([
      [['prompt', 'text'], 'success'],
      [['text'], 'error_max_turns'],
      [['prompt', 'text'], undefined],
    ]);
  });

  it('bounds earlier history, which has no turnEnd, by its prompts', () => {
    const all = turns(
      transcriptTree([prompt('A.', 'earlier'), text('a'), prompt('B.', 'earlier'), text('b')]),
    );
    expect(all.map((turn) => [turn.nodes.length, turn.end])).toEqual([
      [2, undefined],
      [2, undefined],
    ]);
  });
});

describe('shortInput', () => {
  it('prefers the most telling argument, in order', () => {
    expect(shortInput(JSON.stringify({ description: 'd', command: 'ls -la' }))).toBe('ls -la');
    expect(shortInput(JSON.stringify({ file_path: '/a.ts', pattern: 'x' }))).toBe('/a.ts');
    expect(shortInput(JSON.stringify({ url: 'https://example.com' }))).toBe('https://example.com');
  });

  it('falls back to compact JSON, or the raw text, on one line of at most 80 characters', () => {
    expect(shortInput(JSON.stringify({ n: 1 }, null, 2))).toBe('{"n":1}');
    expect(shortInput('{"command": "cut at the ca')).toBe('{"command": "cut at the ca');
    expect(shortInput(JSON.stringify({ command: 'echo\n  hi' }))).toBe('echo hi');
    const long = shortInput(JSON.stringify({ command: 'x'.repeat(200) }));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('instructionPreview', () => {
  it('shows the instruction when the prompt has one, else the prompt, with whitespace collapsed', () => {
    expect(
      instructionPreview(
        'Conversation…\n<instruction>\n  Compare   both\ndesigns.\n</instruction>\nMore.',
      ),
    ).toBe('Compare both designs.');
    expect(instructionPreview('  Just   a\nprompt. ')).toBe('Just a prompt.');
  });
});
