import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';

import {
  actions,
  context,
  errored,
  forwardCall,
  interrupted,
  result,
  speak,
  stateOf,
  toolCall,
  user,
} from './fixtures.test.ts';
import {
  conversationSince,
  renderConversation,
  renderEntry,
  renderHandoff,
  type ConversationEntry,
} from './handoff.ts';
/** The hand-off for the forward call at the cursor, after the forward call `since`. */
const handoffFor = (state: Parameters<typeof conversationSince>[0], since: string | undefined) => {
  const call = state.actions[state.cursor];
  assert.equal(call?.type, 'tool_call');
  const conversation = conversationSince(state, since, call.handle);
  return {
    conversation,
    rendered: renderHandoff({ conversation, isFirstMessage: since === undefined }),
  };
};

const rules = `Respond to the user's latest words. They are the user's own, and take precedence over anything the voice said or showed.

- You are working unattended. The user hears and sees your response only through the voice, in pieces, so include everything needed in it.
- The voice adds nothing of its own. When the user asks to slow down, repeat or re-explain something, do it in your response.
- If anything said or shown to the user misrepresents your work, correct it in your response.
- Do not use the AskUserQuestion tool.
- Run tasks and shell commands in the foreground, not in the background.`;

const diagram =
  'sequenceDiagram\n  Client->>Backend: request\n  Backend-->>Client: 503, retry later';

describe('renderHandoff', () => {
  it('renders a later message exactly: what the voice said and showed, then the listener', () => {
    const state = stateOf(
      actions(
        user('Help me design retries for reconnects.'),
        forwardCall('call_1'),
        result(['call_1'], 'forward_agent', { messages: ['Three options.'] }),
        speak('Okay, so I found three ways to handle retries here.'),
        speak('Each one puts the decision somewhere else.'),
        toolCall('call_2', 'show', { format: 'mermaid', content: diagram }),
        toolCall('call_3', 'ask', {
          kind: 'choice',
          question: 'Which retry approach should we keep?',
          options: [
            { label: 'Harness-level retry' },
            { label: 'Client-level retry' },
            { label: 'No automatic retry' },
          ],
        }),
        result(['call_3'], 'ask', {
          question: 'Which retry approach should we keep?',
          answer: { kind: 'choice', choice: 'Client-level retry' },
        }),
        speak('Nice, client-level it is.'),
        speak('That means the client decides when'),
        interrupted('speech'),
        user("Actually wait, I don't want the client deciding that. The backend should own it."),
        forwardCall('call_4'),
      ),
    );
    assert.equal(
      handoffFor(state, 'call_1').rendered,
      `Here is the voice conversation since the last message you received from it.

<conversation_since_last_message>
**Voice:** Okay, so I found three ways to handle retries here. Each one puts the decision somewhere else.

**Shown to the user** (mermaid):
\`\`\`mermaid
${diagram}
\`\`\`

**Question:** Which retry approach should we keep?
Options: Harness-level retry · Client-level retry · No automatic retry
**Answer:** Client-level retry

**Voice:** Nice, client-level it is. That means the client decides when *(interrupted by the user)*

**User:** Actually wait, I don't want the client deciding that. The backend should own it.
</conversation_since_last_message>

${rules}`,
    );
  });

  it('opens a first message with the conversation so far, or says nothing new was said', () => {
    const first = stateOf(actions(user('Brainstorm names with me.'), forwardCall('call_1')));
    assert.equal(
      handoffFor(first, undefined).rendered,
      `The user is talking with you through a voice conversation. A voice speaks to them as you, in the first person: it presents your responses in short spoken pieces, with material shown on their screen, and passes everything they say back to you. Here is that conversation so far.

<conversation_so_far>
**User:** Brainstorm names with me.
</conversation_so_far>

${rules}`,
    );
    const empty = stateOf(actions(forwardCall('call_1')));
    assert.ok(
      handoffFor(empty, undefined).rendered.includes(
        '<conversation_so_far>\n(Nothing new was said.)\n</conversation_so_far>',
      ),
    );
  });
});

describe('conversationSince', () => {
  it('takes the whole conversation for a first message and excludes the new call', () => {
    const state = stateOf(actions(user('One.'), speak('Two.'), forwardCall('call_1')));
    assert.deepEqual(handoffFor(state, undefined).conversation, [
      { kind: 'user', text: 'One.' },
      { kind: 'voice', speaker: undefined, text: 'Two.' },
    ]);
  });

  it("never hands off a preloaded start's context, only the conversation around it", () => {
    const state = stateOf(
      actions(
        context('My last answer', 'SECRET-CONTEXT'),
        user('Walk me through it.'),
        speak('Sure, here is what I did.'),
        forwardCall('call_1'),
      ),
    );
    const { conversation, rendered } = handoffFor(state, undefined);
    assert.deepEqual(conversation, [
      { kind: 'user', text: 'Walk me through it.' },
      { kind: 'voice', speaker: undefined, text: 'Sure, here is what I did.' },
    ]);
    assert.ok(!rendered.includes('SECRET-CONTEXT'));
  });

  it('starts after the last forward and stops at the new one, ignoring what follows it', () => {
    const state = stateOf(
      actions(
        user('Before.'),
        forwardCall('call_1'),
        user('Between.'),
        forwardCall('call_2'),
        speak('After the call.'),
      ),
      { cursor: 3 },
    );
    assert.deepEqual(handoffFor(state, 'call_1').conversation, [
      { kind: 'user', text: 'Between.' },
    ]);
  });

  it("leaves out the voice's replies to progress updates, through a retry, until the next input", () => {
    const progress = (text: string) =>
      ({ type: 'tool_progress', handles: ['call_1'], tool: 'forward_agent', text }) as const;
    const state = stateOf(
      actions(
        forwardCall('call_1'),
        speak('Let me check.'),
        progress('Reading the docs.'),
        speak("I'm reading the docs."),
        progress('Tracing the session.'),
        { type: 'generation_failed', error: { tag: 'Timeout', message: 'Timed out.' } },
        speak("I'm tracing the session."),
        result(['call_1'], 'forward_agent', { messages: ['Here is how it works.'] }),
        speak("Here's how it works."),
        progress('Still going.'),
        speak('Still on it.'),
        user('Wait, go back.'),
        forwardCall('call_2'),
      ),
    );
    assert.deepEqual(handoffFor(state, 'call_1').conversation, [
      { kind: 'voice', speaker: undefined, text: "Let me check. Here's how it works." },
      { kind: 'user', text: 'Wait, go back.' },
    ]);
  });

  it("excludes forward's own results and errors, and includes other tools' outcomes", () => {
    const state = stateOf(
      actions(
        forwardCall('call_1'),
        result(['call_1'], 'forward_agent', { messages: ['Mine.'] }),
        forwardCall('call_2'),
        errored(['call_2'], 'forward_agent', 'The work stopped with an error (error_max_turns).'),
        toolCall('call_3', 'note', { text: 'x' }),
        result(['call_3'], 'note', { saved: true }),
        toolCall('call_4', 'note', { text: 'y' }),
        errored(['call_4'], 'note', 'Disk full.'),
        forwardCall('call_5'),
      ),
    );
    const { conversation } = handoffFor(state, 'call_1');
    assert.deepEqual(conversation, [
      { kind: 'toolOutcome', tool: 'note', outcome: 'result', text: '{"saved":true}' },
      { kind: 'toolOutcome', tool: 'note', outcome: 'error', text: 'Disk full.' },
    ]);
    assert.equal(
      renderConversation(conversation),
      ['**Result from `note`:**\n{"saved":true}', '**Error from `note`:**\nDisk full.'].join(
        '\n\n',
      ),
    );
  });

  it('excludes a result that answers several forwards, including one before the window', () => {
    const state = stateOf(
      actions(
        forwardCall('call_1'),
        forwardCall('call_2'),
        result(['call_1', 'call_2'], 'forward_agent', { messages: ['Done.'] }),
        forwardCall('call_3'),
      ),
    );
    assert.deepEqual(handoffFor(state, 'call_2').conversation, []);
  });

  it("leaves out invalid Show and Ask calls and their errors (the voice model's mistakes)", () => {
    const state = stateOf(
      actions(
        toolCall('call_1', 'show', { format: 'pdf', content: 'x' }),
        errored(['call_1'], 'show', 'Expected a format.'),
        toolCall('call_2', 'ask', { kind: 'choice', question: 'Q?' }),
        errored(['call_2'], 'ask', 'Expected options.'),
        forwardCall('call_3'),
      ),
    );
    assert.deepEqual(handoffFor(state, undefined).conversation, []);
  });

  describe('Show status', () => {
    // The status rule reads session state as Show's policy shapes it: a rendered Show queues
    // nothing (response `error`) and a failure queues a `tool_errored`. A policy change must break
    // this test instead of silently changing what hand-offs claim.
    it("relies on Show's real policy", () => {
      assert.deepEqual(showTool().policy, { blocking: false, response: 'error', replay: true });
    });

    const show = toolCall('call_1', 'show', {
      title: 'Retry flow',
      format: 'mermaid',
      content: diagram,
    });
    const statusOf = (state: ReturnType<typeof stateOf>) => {
      const [entry] = handoffFor(state, undefined).conversation;
      assert.equal(entry?.kind, 'show');
      return entry;
    };

    it('is failed from a logged error', () => {
      const entry = statusOf(
        stateOf(
          actions(
            show,
            errored(['call_1'], 'show', 'The show could not be rendered: bad arrow'),
            forwardCall('call_2'),
          ),
        ),
      );
      assert.equal(entry.status, 'failed');
      assert.equal(
        renderEntry(entry),
        `**Show failed to render** (mermaid) — "Retry flow": The show could not be rendered: bad arrow\n\`\`\`mermaid\n${diagram}\n\`\`\``,
      );
    });

    it('is failed from a pending error', () => {
      const entry = statusOf(
        stateOf(actions(show, forwardCall('call_2')), {
          pendingResults: [
            errored(['call_1'], 'show', 'The show could not be rendered: x') as never,
          ],
        }),
      );
      assert.equal(entry.status, 'failed');
      assert.equal(entry.failure, 'The show could not be rendered: x');
    });

    it('is awaiting while its execution is open', () => {
      const entry = statusOf(
        stateOf(actions(show, forwardCall('call_2')), {
          executions: [{ handles: ['call_1'], tool: 'show' }],
        }),
      );
      assert.equal(entry.status, 'awaiting');
      assert.equal(
        renderEntry(entry).split('\n')[0],
        `**Being put on the user's screen, not yet confirmed** (mermaid) — "Retry flow":`,
      );
    });

    it('is rendered otherwise', () => {
      const entry = statusOf(stateOf(actions(show, forwardCall('call_2'))));
      assert.equal(entry.status, 'rendered');
      assert.equal(
        renderEntry(entry).split('\n')[0],
        '**Shown to the user** (mermaid) — "Retry flow":',
      );
    });
  });

  it('renders questions with free text, extra text and no answer yet', () => {
    const state = stateOf(
      actions(
        toolCall('call_1', 'ask', { kind: 'text', question: 'What matters most?' }),
        result(['call_1'], 'ask', {
          question: 'What matters most?',
          answer: { kind: 'text', text: 'Speed.' },
        }),
        toolCall('call_2', 'ask', {
          kind: 'multi',
          question: 'Which apply?',
          options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        }),
        result(['call_2'], 'ask', {
          question: 'Which apply?',
          answer: { kind: 'multi', choices: ['A', 'C'], text: ' and maybe B ' },
        }),
        toolCall('call_3', 'ask', { kind: 'text', question: 'Anything else?' }),
        forwardCall('call_4'),
      ),
    );
    assert.equal(
      renderConversation(handoffFor(state, undefined).conversation),
      [
        '**Question:** What matters most?\n**Answer:** Speed.',
        '**Question:** Which apply?\nOptions: A · B · C\n**Answer:** A; C — they added: and maybe B',
        '**Question:** Anything else?\n**Answer:** (not answered yet)',
      ].join('\n\n'),
    );
  });

  it('renders a continue checkpoint as its question and Continue, with no options', () => {
    const state = stateOf(
      actions(
        toolCall('call_1', 'ask', { kind: 'continue', question: 'Ready for the next part?' }),
        result(['call_1'], 'ask', {
          question: 'Ready for the next part?',
          answer: { kind: 'continue' },
        }),
        forwardCall('call_2'),
      ),
    );
    assert.equal(
      renderConversation(handoffFor(state, undefined).conversation),
      '**Question:** Ready for the next part?\n**Answer:** Continue',
    );
  });

  it('labels speakers only with several, splits paragraphs by speaker, and ignores omitted actions', () => {
    const log = actions(
      speak('Hello.', 'host'),
      { type: 'tool_context', tool: 'forward_agent', text: 'The agent is working.' },
      speak('Welcome.', 'host'),
      speak('Hi.', 'guest'),
      forwardCall('call_1'),
    );
    const speakers = [
      { id: 'host', name: 'Ada' },
      { id: 'guest', name: 'Grace' },
    ];
    assert.equal(
      renderConversation(handoffFor(stateOf(log, { speakers }), undefined).conversation),
      '**Voice (Ada):** Hello. Welcome.\n\n**Voice (Grace):** Hi.',
    );
  });

  it('renders a wait interruption, and a speech interruption standalone when no line precedes it', () => {
    const entries: ReadonlyArray<ConversationEntry> = [
      { kind: 'interruption', during: 'wait' },
      { kind: 'user', text: 'Stop.' },
      { kind: 'interruption', during: 'speech' },
    ];
    assert.equal(
      renderConversation(entries),
      '*(The user interrupted to say something.)*\n\n**User:** Stop.\n\n*(The user interrupted to say something.)*',
    );
    assert.equal(
      renderEntry({ kind: 'interruption', during: 'speech' }),
      '*(The user interrupted to say something.)*',
    );
  });

  it('fences content one backtick longer than its longest run, and at least three', () => {
    const fenced = (content: string) =>
      renderEntry({ kind: 'show', input: { format: 'markdown', content }, status: 'rendered' });
    assert.equal(
      fenced('plain `code`'),
      '**Shown to the user** (markdown):\n```markdown\nplain `code`\n```',
    );
    assert.equal(
      fenced('```ts\nx\n```'),
      '**Shown to the user** (markdown):\n````markdown\n```ts\nx\n```\n````',
    );
    assert.ok(fenced('`````').startsWith('**Shown to the user** (markdown):\n``````markdown\n'));
  });
});
