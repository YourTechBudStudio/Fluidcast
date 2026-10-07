import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { maxContentLength } from '../content.ts';
import type { TranscriptEntry } from '../schema.ts';
import {
  assistant,
  progress,
  result,
  say,
  stored,
  text,
  toolResult,
  toolResults,
  toolUse,
} from './frames.test.ts';
import { frameEntries, historyEntries } from './transcript.ts';

const call = (
  toolUseId: string,
  name: string,
  input: string,
  parentToolUseId: string | null = null,
): TranscriptEntry => ({
  _tag: 'toolCall',
  parentToolUseId,
  toolUseId,
  name,
  input,
  truncated: false,
});

const answer = (
  toolUseId: string,
  content: string,
  parentToolUseId: string | null = null,
): TranscriptEntry => ({
  _tag: 'toolResult',
  parentToolUseId,
  toolUseId,
  content,
  truncated: false,
  isError: false,
});

const prompt = (value: string, parentToolUseId: string | null = null): TranscriptEntry => ({
  _tag: 'prompt',
  parentToolUseId,
  source: 'earlier',
  text: value,
});

const line = (value: string, parentToolUseId: string | null = null): TranscriptEntry => ({
  _tag: 'text',
  parentToolUseId,
  text: value,
});

describe('frame entries', () => {
  it('reads assistant text and tool calls, leaving thinking out', () => {
    assert.deepEqual(
      frameEntries(
        assistant([
          { type: 'thinking', thinking: 'Hmm.' },
          text('Looking.'),
          toolUse('call_1', 'Grep', { pattern: 'todo' }),
        ]),
        undefined,
      ),
      [line('Looking.'), call('call_1', 'Grep', '{"pattern":"todo"}')],
    );
  });

  it('nests a live subagent frame under its parent call', () => {
    assert.deepEqual(
      frameEntries(assistant([text('Found it.')], { parent: 'call_9' }), undefined),
      [line('Found it.', 'call_9')],
    );
  });

  it('reads tool results as strings or joined text blocks, with errors, and skips prompts and replays', () => {
    assert.deepEqual(
      frameEntries(
        toolResults([
          text('An echoed prompt.'),
          toolResult('call_1', 'Plain.'),
          toolResult('call_2', [text('One.'), { type: 'image' }, text('Two.')], true),
        ]),
        undefined,
      ),
      [answer('call_1', 'Plain.'), { ...answer('call_2', 'One.\nTwo.'), isError: true }],
    );
    assert.deepEqual(
      frameEntries(toolResults([toolResult('call_1', 'Old.')], { replay: true }), undefined),
      [],
    );
  });

  it('caps tool input and result content', () => {
    const long = 'x'.repeat(maxContentLength + 10);
    const [input] = frameEntries(
      assistant([toolUse('call_1', 'Write', { content: long })]),
      undefined,
    );
    assert.equal(input?._tag === 'toolCall' && input.input.length, maxContentLength);
    assert.equal(input?._tag === 'toolCall' && input.truncated, true);
    const [output] = frameEntries(toolResults([toolResult('call_1', long)]), undefined);
    assert.equal(output?._tag === 'toolResult' && output.content, 'x'.repeat(maxContentLength));
    assert.equal(output?._tag === 'toolResult' && output.truncated, true);
  });

  it('turns results into turn ends', () => {
    const end = (outcome: string, resetsAt?: number): TranscriptEntry => ({
      _tag: 'turnEnd',
      parentToolUseId: null,
      outcome,
      ...(resetsAt === undefined ? {} : { resetsAt }),
    });
    assert.deepEqual(frameEntries(result(), undefined), [end('success')]);
    assert.deepEqual(frameEntries(result({ isError: true }), undefined), [end('api_error')]);
    assert.deepEqual(frameEntries(result({ subtype: 'error_max_turns' }), undefined), [
      end('error_max_turns'),
    ]);
    assert.deepEqual(
      frameEntries(result({ subtype: 'error_during_execution' }), { resetsAt: 1_790_000_000 }),
      [end('usage_limit', 1_790_000_000)],
    );
    assert.deepEqual(frameEntries(result({ isError: true }), { resetsAt: undefined }), [
      end('usage_limit'),
    ]);
    assert.deepEqual(frameEntries(result(), { resetsAt: 1 }), [end('success')]);
  });

  it('reads subagent progress summaries as status entries', () => {
    assert.deepEqual(frameEntries(progress('Reading the tests.', 'call_3'), undefined), [
      { _tag: 'status', parentToolUseId: 'call_3', text: 'Reading the tests.' },
    ]);
    assert.deepEqual(frameEntries(progress('Top.'), undefined), [
      { _tag: 'status', parentToolUseId: null, text: 'Top.' },
    ]);
    assert.deepEqual(frameEntries(progress(undefined, 'call_3'), undefined), []);
    assert.deepEqual(frameEntries(say(''), undefined), []);
  });
});

describe('history entries', () => {
  it('reads the main chain: prompts, text, calls and results, and invents no turn end', () => {
    assert.deepEqual(
      historyEntries(
        [
          stored('user', 'Plan the release.'),
          stored('assistant', [text('Checking.'), toolUse('call_1', 'Read')]),
          stored('user', [toolResult('call_1', 'Contents.')]),
          stored('user', [text('Also update the notes.')]),
        ],
        [],
      ),
      [
        prompt('Plan the release.'),
        line('Checking.'),
        call('call_1', 'Read', '{}'),
        answer('call_1', 'Contents.'),
        prompt('Also update the notes.'),
      ],
    );
  });

  it('anchors a subagent by parent_tool_use_id right after its call, even with no result', () => {
    assert.deepEqual(
      historyEntries(
        [
          stored('user', 'Start.'),
          stored('assistant', [toolUse('call_a', 'Agent', { prompt: 'Explore.' })]),
        ],
        [
          {
            agentId: 'sub1',
            messages: [
              stored('user', 'Explore.', 'call_a'),
              stored('assistant', [text('Explored.')], 'call_a'),
            ],
          },
        ],
      ),
      [
        prompt('Start.'),
        call('call_a', 'Agent', '{"prompt":"Explore."}'),
        prompt('Explore.', 'call_a'),
        line('Explored.', 'call_a'),
      ],
    );
  });

  it('anchors by an agentId line in an Agent result, not a SendMessage mention, earliest first', () => {
    const agentResult = (id: string) =>
      `Async agent launched.\nagentId: ${id} (use SendMessage to continue this agent)`;
    const entries = historyEntries(
      [
        stored('assistant', [toolUse('call_s', 'SendMessage')]),
        stored('user', [toolResult('call_s', 'agentId: sub1')]),
        stored('assistant', [toolUse('call_a', 'Agent')]),
        stored('user', [toolResult('call_a', [text(agentResult('sub1'))])]),
        stored('assistant', [toolUse('call_b', 'Task')]),
        stored('user', [toolResult('call_b', 'agentId: sub1')]),
      ],
      [{ agentId: 'sub1', messages: [stored('user', 'Explore.')] }],
    );
    assert.deepEqual(entries, [
      call('call_s', 'SendMessage', '{}'),
      answer('call_s', 'agentId: sub1'),
      call('call_a', 'Agent', '{}'),
      prompt('Explore.', 'call_a'),
      answer('call_a', agentResult('sub1')),
      call('call_b', 'Task', '{}'),
      answer('call_b', 'agentId: sub1'),
    ]);
  });

  it('does not match an agentId line for a longer ID', () => {
    const entries = historyEntries(
      [
        stored('assistant', [toolUse('call_a', 'Agent')]),
        stored('user', [toolResult('call_a', 'agentId: sub10')]),
      ],
      [{ agentId: 'sub1', messages: [stored('user', 'Explore.')] }],
    );
    assert.equal(entries.at(-2)?._tag, 'status');
  });

  it('shows a subagent it cannot place as unlinked, after the main chain', () => {
    assert.deepEqual(
      historyEntries(
        [stored('user', 'Start.')],
        [
          {
            agentId: 'lost',
            messages: [
              stored('user', 'Explore.', 'call_gone'),
              stored('assistant', [text('Explored.')], 'call_gone'),
            ],
          },
        ],
      ),
      [
        prompt('Start.'),
        {
          _tag: 'status',
          parentToolUseId: null,
          text: 'Earlier subagent lost: the call that started it is not in this history.',
        },
        prompt('Explore.'),
        line('Explored.'),
      ],
    );
  });

  it('nests a subagent started by a subagent under its parent subagent call', () => {
    assert.deepEqual(
      historyEntries(
        [stored('assistant', [toolUse('call_a', 'Agent')])],
        [
          {
            agentId: 'inner',
            messages: [stored('user', 'Look deeper.', 'call_b')],
          },
          {
            agentId: 'outer',
            messages: [
              stored('user', 'Explore.', 'call_a'),
              stored('assistant', [toolUse('call_b', 'Agent')], 'call_a'),
              stored('user', [toolResult('call_b', 'Deeper result.')], 'call_a'),
            ],
          },
        ],
      ),
      [
        call('call_a', 'Agent', '{}'),
        prompt('Explore.', 'call_a'),
        call('call_b', 'Agent', '{}', 'call_a'),
        prompt('Look deeper.', 'call_b'),
        answer('call_b', 'Deeper result.', 'call_a'),
      ],
    );
  });

  it('shows subagents whose starting calls lead back to themselves as unlinked', () => {
    const entries = historyEntries(
      [],
      [
        {
          agentId: 'one',
          messages: [stored('assistant', [toolUse('call_1', 'Agent')], 'call_2')],
        },
        {
          agentId: 'two',
          messages: [stored('assistant', [toolUse('call_2', 'Agent')], 'call_1')],
        },
      ],
    );
    assert.deepEqual(
      entries.filter((entry) => entry._tag === 'status').map((entry) => entry.text),
      [
        'Earlier subagent one: the call that started it is not in this history.',
        'Earlier subagent two: the call that started it is not in this history.',
      ],
    );
    assert.deepEqual(
      entries.filter((entry) => entry._tag === 'toolCall').map((entry) => entry.parentToolUseId),
      [null, null],
    );
  });
});
