import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { showTool } from '@yourtechbudstudio/fluidcast-tool-show';

import {
  actions,
  agentCall,
  errored,
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
import { agentInput } from './schema.ts';

const input = agentInput(['claude']);

/** The hand-off for the call at the cursor, sent to `own` after the call `since`. */
const handoffFor = (
  state: Parameters<typeof conversationSince>[0],
  since: string | undefined,
  own = 'brainstorm',
) => {
  const call = state.actions[state.cursor];
  assert.equal(call?.type, 'tool_call');
  const conversation = conversationSince(state, since, call.handle, own, input);
  return {
    conversation,
    rendered: renderHandoff({
      agentType: 'claude',
      agent: own,
      instruction: String((call.input as { message: string }).message),
      conversation,
      isFirstMessage: since === undefined,
    }),
  };
};

const rules = `Interpret the instruction in light of the conversation above and our earlier conversation. Where they disagree, the user's own words take precedence over the instruction.

- You are working unattended. A voice agent presents your responses to the user in pieces and relays their reactions back to you.
- Put any questions for the user in your response. Do not use the AskUserQuestion tool.
- If anything shown or said to the user misrepresents your work, correct it in your response.
- Run tasks and shell commands in the foreground, not in the background.

Your response will be presented to the user by voice, in pieces. Include everything needed in it.`;

const diagram =
  'sequenceDiagram\n  Client->>Backend: request\n  Backend-->>Client: 503, retry later';

describe('renderHandoff', () => {
  it("renders the story's example exactly (a later message)", () => {
    const state = stateOf(
      actions(
        user('Help me design retries for reconnects.'),
        agentCall('call_1', 'brainstorm', 'Propose retry designs.'),
        result(['call_1'], 'agent', { agent: 'brainstorm', messages: ['Three options.'] }),
        speak('Okay, so there are three ways to handle retries here.'),
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
        agentCall(
          'call_4',
          'brainstorm',
          'The user changed their mind: retries should be owned by the backend, not the client. Revise the retry proposal and continue.',
        ),
      ),
    );
    assert.equal(
      handoffFor(state, 'call_1').rendered,
      `The user responded through the voice conversation since your last message.

<conversation_since_last_message>
**Interface agent:** Okay, so there are three ways to handle retries here. Each one puts the decision somewhere else.

**Shown to the user** (mermaid):
\`\`\`mermaid
${diagram}
\`\`\`

**Question:** Which retry approach should we keep?
Options: Harness-level retry · Client-level retry · No automatic retry
**Answer:** Client-level retry

**Interface agent:** Nice, client-level it is. That means the client decides when *(interrupted by the user)*

**User:** Actually wait, I don't want the client deciding that. The backend should own it.
</conversation_since_last_message>

<instruction>
The user changed their mind: retries should be owned by the backend, not the client. Revise the retry proposal and continue.
</instruction>

${rules}`,
    );
  });

  it('opens a first message with the conversation so far, or says nothing new was said', () => {
    const first = stateOf(
      actions(user('Brainstorm names with me.'), agentCall('call_1', 'names', 'Suggest names.')),
    );
    assert.equal(
      handoffFor(first, undefined, 'names').rendered,
      `The user is talking with you through a voice conversation. Here is that conversation so far.

<conversation_so_far>
**User:** Brainstorm names with me.
</conversation_so_far>

<instruction>
Suggest names.
</instruction>

${rules}`,
    );
    const empty = stateOf(actions(agentCall('call_1', 'names', 'Start.')));
    assert.ok(
      handoffFor(empty, undefined, 'names').rendered.includes(
        '<conversation_so_far>\n(Nothing new was said.)\n</conversation_so_far>',
      ),
    );
  });
});

describe('conversationSince', () => {
  it('takes the whole conversation for a first message and excludes the new call', () => {
    const state = stateOf(
      actions(user('One.'), speak('Two.'), agentCall('call_1', 'brainstorm', 'Go.')),
    );
    assert.deepEqual(handoffFor(state, undefined).conversation, [
      { kind: 'user', text: 'One.' },
      { kind: 'interfaceAgent', speaker: undefined, text: 'Two.' },
    ]);
  });

  it('starts after the last call to this worker and stops at the new call, ignoring what follows it', () => {
    const state = stateOf(
      actions(
        user('Before.'),
        agentCall('call_1', 'brainstorm', 'First.'),
        user('Between.'),
        agentCall('call_2', 'brainstorm', 'Second.'),
        speak('After the call.'),
      ),
      { cursor: 3 },
    );
    assert.deepEqual(handoffFor(state, 'call_1').conversation, [
      { kind: 'user', text: 'Between.' },
    ]);
  });

  it("excludes this worker's own results and includes other workers' and other tools' outcomes", () => {
    const state = stateOf(
      actions(
        agentCall('call_1', 'brainstorm', 'First.'),
        agentCall('call_2', 'research', 'Look it up.'),
        agentCall('call_3', 'review', 'Review it.'),
        result(['call_1'], 'agent', { agent: 'brainstorm', messages: ['Mine.'] }),
        result(['call_2'], 'agent', { agent: 'research', messages: ['Found A.', 'Found B.'] }),
        errored(
          ['call_3'],
          'agent',
          'The worker "review" stopped with an error (error_max_turns).',
        ),
        toolCall('call_4', 'note', { text: 'x' }),
        result(['call_4'], 'note', { saved: true }),
        toolCall('call_5', 'note', { text: 'y' }),
        errored(['call_5'], 'note', 'Disk full.'),
        agentCall('call_6', 'brainstorm', 'Continue.'),
      ),
    );
    const { conversation } = handoffFor(state, 'call_1');
    assert.deepEqual(conversation, [
      {
        kind: 'toolOutcome',
        tool: 'agent',
        agent: 'research',
        outcome: 'result',
        text: 'Found A.\n\nFound B.',
      },
      {
        kind: 'toolOutcome',
        tool: 'agent',
        agent: 'review',
        outcome: 'error',
        text: 'The worker "review" stopped with an error (error_max_turns).',
      },
      { kind: 'toolOutcome', tool: 'note', outcome: 'result', text: '{"saved":true}' },
      { kind: 'toolOutcome', tool: 'note', outcome: 'error', text: 'Disk full.' },
    ]);
    assert.equal(
      renderConversation(conversation),
      [
        '**Result from agent "research":**\nFound A.\n\nFound B.',
        '**Error from agent "review":**\nThe worker "review" stopped with an error (error_max_turns).',
        '**Result from `note`:**\n{"saved":true}',
        '**Error from `note`:**\nDisk full.',
      ].join('\n\n'),
    );
  });

  it('excludes own results that answer several calls, including one before the window', () => {
    const state = stateOf(
      actions(
        agentCall('call_1', 'brainstorm', 'First.'),
        agentCall('call_2', 'brainstorm', 'Steer.'),
        result(['call_1', 'call_2'], 'agent', { agent: 'brainstorm', messages: ['Done.'] }),
        agentCall('call_3', 'brainstorm', 'Next.'),
      ),
    );
    assert.deepEqual(handoffFor(state, 'call_2').conversation, []);
  });

  it("leaves out invalid Show, Ask and agent calls and their errors (the interface model's mistakes)", () => {
    const state = stateOf(
      actions(
        toolCall('call_1', 'show', { format: 'pdf', content: 'x' }),
        errored(['call_1'], 'show', 'Expected a format.'),
        toolCall('call_2', 'ask', { kind: 'choice', question: 'Q?' }),
        errored(['call_2'], 'ask', 'Expected options.'),
        agentCall('call_3', 'Bad ID', 'Go.'),
        errored(['call_3'], 'agent', 'Expected an id.'),
        agentCall('call_4', 'research', 'Go.', 'codex'),
        errored(['call_4'], 'agent', 'Expected claude.'),
        agentCall('call_5', 'brainstorm', 'Go.'),
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
            agentCall('call_2', 'brainstorm', 'Go.'),
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
        stateOf(actions(show, agentCall('call_2', 'brainstorm', 'Go.')), {
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
        stateOf(actions(show, agentCall('call_2', 'brainstorm', 'Go.')), {
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
      const entry = statusOf(stateOf(actions(show, agentCall('call_2', 'brainstorm', 'Go.'))));
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
        agentCall('call_4', 'brainstorm', 'Go.'),
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

  it('labels speakers only with several, splits paragraphs by speaker, and ignores omitted actions', () => {
    const log = actions(
      speak('Hello.', 'host'),
      { type: 'tool_context', tool: 'agent', text: 'Workers:' },
      speak('Welcome.', 'host'),
      speak('Hi.', 'guest'),
      agentCall('call_1', 'brainstorm', 'Go.'),
    );
    const speakers = [
      { id: 'host', name: 'Ada' },
      { id: 'guest', name: 'Grace' },
    ];
    assert.equal(
      renderConversation(handoffFor(stateOf(log, { speakers }), undefined).conversation),
      '**Interface agent (Ada):** Hello. Welcome.\n\n**Interface agent (Grace):** Hi.',
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
