import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Schema } from 'effect';

import { makeActionId, type Action } from '../actions/index.ts';
import { cutOffNotice, renderHistory } from './history.ts';
import type { ToolDefinition } from './tools.ts';

const note: ToolDefinition<{ readonly body: string }, { readonly count: number }> = {
  name: 'note',
  input: Schema.Struct({ body: Schema.String }),
  guidelines: [],
  result: Schema.Struct({ count: Schema.Number }),
  renderResult: ({ count }) => `Pinned <${count}> & done.`,
};

const id = makeActionId;

describe('renderHistory', () => {
  it('renders a tool call with its handle after `type`, then its input', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'user_message', id: id(), text: 'Hi' },
      { type: 'speak', id: id(), speaker: 'host', text: 'Look.' },
      {
        type: 'tool_call',
        id: id(),
        handle: 'call_1',
        tool: 'note',
        input: { body: 'A', extra: [1] },
      },
    ];
    const messages = renderHistory(history, [note]);
    assert.deepEqual(messages[1], {
      role: 'assistant',
      content:
        '[{"type":"speak","speaker":"host","text":"Look."},{"type":"note","call":"call_1","body":"A","extra":[1]}]',
    });
  });

  it('renders escaped result and error envelopes carrying `call` and `tool`', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'tool_call', id: id(), handle: 'call_1', tool: 'note', input: { body: 'A' } },
      { type: 'tool_call', id: id(), handle: 'call_2', tool: 'n"o<te', input: {} },
      { type: 'tool_result', id: id(), handle: 'call_1', tool: 'note', result: { count: 2 } },
      {
        type: 'tool_errored',
        id: id(),
        handle: 'call_2',
        tool: 'n"o<te',
        message: 'Unknown <type> & more',
      },
    ];
    assert.deepEqual(renderHistory(history, [note])[1], {
      role: 'user',
      content: [
        '<tool_result call="call_1" tool="note">Pinned &lt;2&gt; &amp; done.</tool_result>',
        '<tool_error call="call_2" tool="n&quot;o&lt;te">Unknown &lt;type&gt; &amp; more</tool_error>',
      ].join('\n'),
    });
  });

  it('omits a fault', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'user_message', id: id(), text: 'Hi' },
      { type: 'tool_call', id: id(), handle: 'call_1', tool: 'note', input: { body: 'A' } },
      {
        type: 'tool_faulted',
        id: id(),
        handle: 'call_1',
        error: { tag: 'ToolFault', message: 'The note tool failed (disk).' },
      },
    ];
    assert.deepEqual(
      renderHistory(history, [note]).map((message) => message.role),
      ['user', 'assistant'],
    );
  });

  it('uses the cut-off notice after a tool call', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'tool_call', id: id(), handle: 'call_1', tool: 'note', input: { body: 'A' } },
      { type: 'generation_failed', id: id(), error: { tag: 'ProviderError', message: 'x' } },
    ];
    assert.deepEqual(renderHistory(history, [note])[1], {
      role: 'user',
      content: `<notice>${cutOffNotice}</notice>`,
    });
  });

  it('throws when a stored result names a tool that is not configured', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'tool_result', id: id(), handle: 'call_1', tool: 'note', result: { count: 2 } },
    ];
    assert.throws(() => renderHistory(history, []));
  });
});
