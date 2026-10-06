import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Schema } from 'effect';

import { makeActionId, type Action } from '../actions/index.ts';
import {
  cutOffNotice,
  failedBeforeLinesNotice,
  interruptedNotice,
  interruptedToSpeakNotice,
  renderHistory,
} from './history.ts';
import type { ReminderEvent } from './reminders.ts';
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
  it("reads a tool's earlier calls back through its `renderCall`", () => {
    const reshaped: ToolDefinition = {
      ...note,
      renderCall: (input) => ({ ...input, body: 'short' }),
    };
    const history: ReadonlyArray<Action> = [
      { type: 'user_message', id: id(), text: 'Hi' },
      {
        type: 'tool_call',
        id: id(),
        handle: 'call_1',
        tool: 'note',
        input: { body: 'A long body' },
      },
    ];
    assert.deepEqual(renderHistory(history, [reshaped])[1], {
      role: 'assistant',
      content: JSON.stringify([{ type: 'note', call: 'call_1', body: 'short' }]),
    });
  });

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
      { type: 'tool_result', id: id(), handles: ['call_1'], tool: 'note', result: { count: 2 } },
      {
        type: 'tool_errored',
        id: id(),
        handles: ['call_2'],
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
        handles: ['call_1'],
        tool: 'note',
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
      { type: 'tool_result', id: id(), handles: ['call_1'], tool: 'note', result: { count: 2 } },
    ];
    assert.throws(() => renderHistory(history, []));
  });

  it('renders `calls` when one outcome or progress update answers several calls', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'tool_call', id: id(), handle: 'call_3', tool: 'note', input: { body: 'A' } },
      { type: 'tool_call', id: id(), handle: 'call_7', tool: 'note', input: { body: 'B' } },
      {
        type: 'tool_progress',
        id: id(),
        handles: ['call_3', 'call_7'],
        tool: 'note',
        text: 'Reading <files> & tests.',
      },
      { type: 'speak', id: id(), speaker: 'host', text: 'Still going.' },
      {
        type: 'tool_result',
        id: id(),
        handles: ['call_3', 'call_7'],
        tool: 'note',
        result: { count: 1 },
      },
      { type: 'tool_errored', id: id(), handles: ['call_3', 'call_7'], tool: 'note', message: 'x' },
      { type: 'tool_progress', id: id(), handles: ['call_3'], tool: 'note', text: 'One.' },
    ];
    const messages = renderHistory(history, [note]);
    assert.deepEqual(
      messages.map((message) => message.content),
      [
        '[{"type":"note","call":"call_3","body":"A"},{"type":"note","call":"call_7","body":"B"}]',
        '<tool_progress calls="call_3 call_7" tool="note">Reading &lt;files&gt; &amp; tests.</tool_progress>',
        '[{"type":"speak","speaker":"host","text":"Still going."}]',
        [
          '<tool_result calls="call_3 call_7" tool="note">Pinned &lt;1&gt; &amp; done.</tool_result>',
          '<tool_error calls="call_3 call_7" tool="note">x</tool_error>',
          '<tool_progress call="call_3" tool="note">One.</tool_progress>',
        ].join('\n'),
      ],
    );
  });

  it('renders the notice that matches what an interrupt cut', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'speak', id: id(), speaker: 'host', text: 'Look.' },
      { type: 'interrupted', id: id(), during: 'speech' },
      { type: 'user_message', id: id(), text: 'Wait' },
      { type: 'speak', id: id(), speaker: 'host', text: 'Sure.' },
      { type: 'interrupted', id: id(), during: 'wait' },
      { type: 'user_message', id: id(), text: 'Also' },
    ];
    const messages = renderHistory(history, [note]);
    assert.equal(
      messages[1]?.content,
      `<notice>${interruptedNotice}</notice>\n<user_message>Wait</user_message>`,
    );
    assert.equal(
      messages[3]?.content,
      `<notice>${interruptedToSpeakNotice}</notice>\n<user_message>Also</user_message>`,
    );
    assert.equal(interruptedToSpeakNotice, 'The user interrupted to say something.');
  });

  it('renders only the latest non-empty context per tool, last, in tool order', () => {
    const other: ToolDefinition = { ...note, name: 'other' };
    const history: ReadonlyArray<Action> = [
      { type: 'tool_context', id: id(), tool: 'other', text: 'old <other>' },
      { type: 'tool_context', id: id(), tool: 'note', text: 'note & state' },
      { type: 'user_message', id: id(), text: 'Hi' },
      { type: 'speak', id: id(), speaker: 'host', text: 'Hello.' },
      { type: 'tool_context', id: id(), tool: 'other', text: 'new <other>' },
      { type: 'user_message', id: id(), text: 'Next' },
    ];
    const messages = renderHistory(history, [note, other]);
    assert.deepEqual(
      messages.map((message) => message.content),
      [
        '<user_message>Hi</user_message>',
        '[{"type":"speak","speaker":"host","text":"Hello."}]',
        [
          '<user_message>Next</user_message>',
          '<context tool="note">note &amp; state</context>',
          '<context tool="other">new &lt;other&gt;</context>',
        ].join('\n'),
      ],
    );
  });

  it('omits a withdrawn context', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'tool_context', id: id(), tool: 'note', text: 'busy' },
      { type: 'user_message', id: id(), text: 'Hi' },
      { type: 'tool_context', id: id(), tool: 'note', text: '' },
    ];
    assert.deepEqual(renderHistory(history, [note]), [
      { role: 'user', content: '<user_message>Hi</user_message>' },
    ]);
  });

  it('renders a context in place, escaped, before its message and before tool contexts', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'context', id: id(), label: 'My "last" answer', text: 'a < b' },
      { type: 'user_message', id: id(), text: 'Walk me through it.' },
      { type: 'tool_context', id: id(), tool: 'note', text: 'idle' },
    ];
    assert.deepEqual(renderHistory(history, [note]), [
      {
        role: 'user',
        content: [
          '<context label="My &quot;last&quot; answer">a &lt; b</context>',
          '<user_message>Walk me through it.</user_message>',
          '<context tool="note">idle</context>',
        ].join('\n'),
      },
    ]);
  });

  it('adds a user run for the context when the history ends with the assistant', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'tool_context', id: id(), tool: 'note', text: 'busy' },
      { type: 'speak', id: id(), speaker: 'host', text: 'Hello.' },
    ];
    assert.deepEqual(renderHistory(history, [note]), [
      { role: 'assistant', content: '[{"type":"speak","speaker":"host","text":"Hello."}]' },
      { role: 'user', content: '<context tool="note">busy</context>' },
    ]);
  });

  it('chooses the failure notice by the action before the failure, not a later context', () => {
    const failed = {
      type: 'generation_failed',
      id: id(),
      error: { tag: 'ProviderError', message: 'x' },
    } as const;
    const cut: ReadonlyArray<Action> = [
      { type: 'speak', id: id(), speaker: 'host', text: 'Hello.' },
      failed,
      { type: 'tool_context', id: id(), tool: 'note', text: 'busy' },
    ];
    assert.deepEqual(renderHistory(cut, [note])[1], {
      role: 'user',
      content: `<notice>${cutOffNotice}</notice>\n<context tool="note">busy</context>`,
    });
    const before: ReadonlyArray<Action> = [
      { type: 'user_message', id: id(), text: 'Hi' },
      { type: 'tool_context', id: id(), tool: 'note', text: 'busy' },
      { ...failed, id: id() },
      { type: 'tool_context', id: id(), tool: 'note', text: 'idle' },
    ];
    assert.deepEqual(renderHistory(before, [note]), [
      {
        role: 'user',
        content: [
          '<user_message>Hi</user_message>',
          `<notice>${failedBeforeLinesNotice}</notice>`,
          '<context tool="note">idle</context>',
        ].join('\n'),
      },
    ]);
  });
});

describe('renderHistory reminders', () => {
  const other: ToolDefinition = { ...note, name: 'other' };
  /** A configuration's reminders: per tool result, none for listener messages. */
  const configured = (event: ReminderEvent): string | undefined => {
    if (event._tag === 'UserMessage') return undefined;
    if (event.tool === 'other') return 'Other first.';
    const { count } = event.result as { readonly count: number };
    return count > 1 ? `Several <${count}>.` : undefined;
  };
  const result = (tool: string, count: number, handle = 'call_1'): Action => ({
    type: 'tool_result',
    id: id(),
    handles: [handle],
    tool,
    result: { count },
  });
  const lastInput = (messages: ReadonlyArray<{ readonly content: string }>) =>
    messages.at(-1)?.content;

  it('follows the newest tool result with its reminder, escaped, before the context', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'tool_call', id: id(), handle: 'call_1', tool: 'note', input: { body: 'A' } },
      result('note', 2),
      { type: 'tool_context', id: id(), tool: 'note', text: 'busy' },
    ];
    assert.equal(
      lastInput(renderHistory(history, [note], { reminders: configured })),
      [
        '<tool_result call="call_1" tool="note">Pinned &lt;2&gt; &amp; done.</tool_result>',
        '<reminder>Several &lt;2&gt;.</reminder>',
        '<context tool="note">busy</context>',
      ].join('\n'),
    );
  });

  it('shows nothing for older inputs, so earlier messages never change', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'user_message', id: id(), text: 'Hi' },
      { type: 'tool_call', id: id(), handle: 'call_1', tool: 'note', input: { body: 'A' } },
      result('note', 2),
      { type: 'speak', id: id(), speaker: 'host', text: 'Done.' },
      { type: 'user_message', id: id(), text: 'Next' },
    ];
    const reminders = (event: ReminderEvent) =>
      event._tag === 'UserMessage' ? `About "${event.text}".` : configured(event);
    const messages = renderHistory(history, [note], { reminders });
    assert.deepEqual(
      messages.map((message) => message.content),
      [
        '<user_message>Hi</user_message>',
        '[{"type":"note","call":"call_1","body":"A"}]',
        '<tool_result call="call_1" tool="note">Pinned &lt;2&gt; &amp; done.</tool_result>',
        '[{"type":"speak","speaker":"host","text":"Done."}]',
        '<user_message>Next</user_message>\n<reminder>About "Next".</reminder>',
      ],
    );
  });

  it('reminds about the newest of a user message and a tool result in the final run', () => {
    const reminders = (event: ReminderEvent) =>
      event._tag === 'UserMessage' ? 'Message.' : 'Result.';
    const resultLast: ReadonlyArray<Action> = [
      { type: 'tool_call', id: id(), handle: 'call_1', tool: 'note', input: { body: 'A' } },
      { type: 'user_message', id: id(), text: 'Hi' },
      result('note', 1),
      { type: 'tool_progress', id: id(), handles: ['call_2'], tool: 'note', text: 'Later.' },
    ];
    assert.equal(
      lastInput(renderHistory(resultLast, [note], { reminders })),
      [
        '<user_message>Hi</user_message>',
        '<tool_result call="call_1" tool="note">Pinned &lt;1&gt; &amp; done.</tool_result>',
        '<reminder>Result.</reminder>',
        '<tool_progress call="call_2" tool="note">Later.</tool_progress>',
      ].join('\n'),
    );
    const messageLast: ReadonlyArray<Action> = [
      { type: 'tool_call', id: id(), handle: 'call_1', tool: 'note', input: { body: 'A' } },
      result('note', 1),
      { type: 'user_message', id: id(), text: 'Hi' },
    ];
    assert.equal(
      lastInput(renderHistory(messageLast, [note], { reminders })),
      [
        '<tool_result call="call_1" tool="note">Pinned &lt;1&gt; &amp; done.</tool_result>',
        '<user_message>Hi</user_message>',
        '<reminder>Message.</reminder>',
      ].join('\n'),
    );
  });

  it('marks a user message that follows an interruption notice', () => {
    const seen: Array<ReminderEvent> = [];
    const reminders = (event: ReminderEvent) => {
      seen.push(event);
      return undefined;
    };
    const plain: ReadonlyArray<Action> = [
      { type: 'speak', id: id(), speaker: 'host', text: 'Look.' },
      { type: 'user_message', id: id(), text: 'Plain' },
    ];
    const cut: ReadonlyArray<Action> = [
      { type: 'speak', id: id(), speaker: 'host', text: 'Look.' },
      { type: 'interrupted', id: id(), during: 'speech' },
      result('note', 1),
      { type: 'user_message', id: id(), text: 'Wait' },
    ];
    const retried: ReadonlyArray<Action> = [
      { type: 'interrupted', id: id(), during: 'wait' },
      { type: 'user_message', id: id(), text: 'First' },
      { type: 'generation_failed', id: id(), error: { tag: 'ProviderError', message: 'x' } },
      { type: 'user_message', id: id(), text: 'Again' },
    ];
    for (const history of [plain, cut, retried]) {
      assert.ok(!lastInput(renderHistory(history, [note], { reminders }))?.includes('<reminder>'));
    }
    assert.deepEqual(seen, [
      { _tag: 'UserMessage', text: 'Plain', interrupted: false, context: [] },
      { _tag: 'UserMessage', text: 'Wait', interrupted: true, context: [] },
      { _tag: 'UserMessage', text: 'Again', interrupted: false, context: [] },
    ]);
  });

  it('reports the labels of the context read with the newest message', () => {
    const reminders = (event: ReminderEvent) =>
      event._tag === 'UserMessage' ? `Context: ${event.context.join('|')}.` : undefined;
    const started: ReadonlyArray<Action> = [
      { type: 'context', id: id(), label: 'First', text: 'A' },
      { type: 'context', id: id(), label: 'Second', text: 'B' },
      { type: 'user_message', id: id(), text: 'Go' },
    ];
    assert.ok(
      lastInput(renderHistory(started, [note], { reminders }))?.endsWith(
        '<reminder>Context: First|Second.</reminder>',
      ),
    );
    const later: ReadonlyArray<Action> = [
      ...started,
      { type: 'speak', id: id(), speaker: 'host', text: 'Sure.' },
      { type: 'user_message', id: id(), text: 'Next' },
    ];
    assert.equal(
      lastInput(renderHistory(later, [note], { reminders })),
      '<user_message>Next</user_message>\n<reminder>Context: .</reminder>',
    );
  });

  it('passes each tool result, decoded, to the reminders, and drops blank text', () => {
    const seen: Array<ReminderEvent> = [];
    const history: ReadonlyArray<Action> = [result('note', 3)];
    const reminder = (reminders: (event: ReminderEvent) => string | undefined) =>
      lastInput(renderHistory(history, [note], { reminders }))?.split('\n')[1];
    assert.equal(
      reminder((event) => {
        seen.push(event);
        return configured(event);
      }),
      '<reminder>Several &lt;3&gt;.</reminder>',
    );
    assert.deepEqual(seen, [{ _tag: 'ToolResult', tool: 'note', result: { count: 3 } }]);
    assert.equal(
      reminder(() => undefined),
      undefined,
    );
    assert.equal(
      reminder(() => '  '),
      undefined,
    );
  });

  it('combines the reminders of results that arrive together, in tool order, once each', () => {
    const history: ReadonlyArray<Action> = [
      { type: 'user_message', id: id(), text: 'Hi' },
      result('note', 2, 'call_1'),
      result('other', 1, 'call_2'),
      result('note', 2, 'call_3'),
    ];
    assert.equal(
      lastInput(renderHistory(history, [other, note], { reminders: configured })),
      [
        '<user_message>Hi</user_message>',
        '<tool_result call="call_1" tool="note">Pinned &lt;2&gt; &amp; done.</tool_result>',
        '<tool_result call="call_2" tool="other">Pinned &lt;1&gt; &amp; done.</tool_result>',
        '<tool_result call="call_3" tool="note">Pinned &lt;2&gt; &amp; done.</tool_result>',
        '<reminder>Other first.\nSeveral &lt;2&gt;.</reminder>',
      ].join('\n'),
    );
  });

  it('renders no reminder without reminders, when they give none, or after the assistant', () => {
    const quiet: ReadonlyArray<Action> = [result('note', 1)];
    assert.deepEqual(
      renderHistory(quiet, [note]),
      renderHistory(quiet, [note], { reminders: configured }),
    );
    assert.deepEqual(renderHistory(quiet, [note]), [
      {
        role: 'user',
        content:
          '<tool_result call="call_1" tool="note">Pinned &lt;1&gt; &amp; done.</tool_result>',
      },
    ]);
    const answered: ReadonlyArray<Action> = [
      result('note', 2),
      { type: 'speak', id: id(), speaker: 'host', text: 'Done.' },
      { type: 'generation_failed', id: id(), error: { tag: 'ProviderError', message: 'x' } },
    ];
    const messages = renderHistory(answered, [note], { reminders: () => 'Never.' });
    assert.ok(messages.every((message) => !message.content.includes('<reminder>')));
  });
});
