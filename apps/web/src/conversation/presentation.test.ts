import { describe, expect, it } from 'vitest';

import { TransportError } from '@yourtechbudstudio/fluidcast-client';
import type { ActionId, Speak } from '@yourtechbudstudio/fluidcast-core/actions';
import type { Execution, ExecutionId } from '@yourtechbudstudio/fluidcast-harness/protocol';
import type { AskCommand, AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

import type { PlaybackStatus } from '../playback';
import type { Action, Connection, ConversationView } from './model';
import { present, type TimelineRow } from './presentation';
import { showCorrectionOf } from './tools';

// Fixtures: a view is built from its actions, like the Client SDK's projection.

const aid = (id: string) => id as ActionId;
const eid = (id: string) => id as ExecutionId;

const user = (id: string, text = 'Teach me.'): Action => ({
  type: 'user_message',
  id: aid(id),
  text,
});
const speak = (id: string, text = `Line ${id}.`): Speak => ({
  type: 'speak',
  id: aid(id),
  speaker: 'host',
  text,
});
const call = (id: string, handle: string, tool: string, input: object): Action => ({
  type: 'tool_call',
  id: aid(id),
  handle,
  tool,
  input: input as never,
});
const showCall = (id: string, handle: string, title = 'Roles') =>
  call(id, handle, 'show', { title, format: 'markdown', content: '# Roles' });
const choice: AskInput = {
  kind: 'choice',
  question: 'Which side checks a password?',
  options: [{ label: 'Client' }, { label: 'Server' }],
};
const text: AskInput = { kind: 'text', question: 'Which client do you use daily?' };
const askCall = (id: string, handle: string, input: AskInput = choice) =>
  call(id, handle, 'ask', input);
const answered = (id: string, handle: string, answer: AskCommand, input: AskInput = choice) =>
  ({
    type: 'tool_result',
    id: aid(id),
    handle,
    tool: 'ask',
    result: { question: input.question, answer },
  }) as const;
const errored = (id: string, handle: string, tool: string, message: string) =>
  ({ type: 'tool_errored', id: aid(id), handle, tool, message }) as const;
const faulted = (id: string, handle: string, message: string): Action => ({
  type: 'tool_faulted',
  id: aid(id),
  handle,
  error: { tag: 'UnexpectedError', message },
});
const execution = (id: string, handle: string, tool: string): Execution => ({
  executionId: eid(id),
  handle,
  tool,
  blocking: tool === 'ask',
});

const view = (partial: Partial<ConversationView>): ConversationView => ({
  actions: [],
  phase: 'idle',
  speakers: [{ id: 'host', name: 'Host' }],
  executions: [],
  pendingResults: [],
  presented: undefined,
  ...partial,
});

const idle: PlaybackStatus = { kind: 'idle' };
const none: ReadonlySet<ExecutionId> = new Set();

const presentOf = (
  v: ConversationView,
  options: {
    readonly connection?: Connection;
    readonly playback?: PlaybackStatus;
    readonly sendFailure?: TransportError | null;
    readonly unresolved?: ReadonlySet<ExecutionId>;
  } = {},
) =>
  present(
    v,
    options.connection ?? 'connected',
    options.playback ?? idle,
    options.sendFailure ?? null,
    options.unresolved ?? none,
  );

const rowOf = <K extends TimelineRow['kind']>(rows: readonly TimelineRow[], kind: K) =>
  rows.filter((row): row is Extract<TimelineRow, { kind: K }> => row.kind === kind);

// A turn that ends in a choice question.
const asked = [user('u1'), speak('s1'), askCall('c1', 'call_1')];
const answer: AskCommand = { kind: 'choice', choice: 'Server', text: 'probably' };

describe('the Ask in place of the composer', () => {
  it('is open while its execution waits, and holds the turn', () => {
    const p = presentOf(
      view({ actions: asked, phase: 'waiting', executions: [execution('e1', 'call_1', 'ask')] }),
    );
    expect(p.ask).toMatchObject({ mode: 'open', input: choice, execution: { handle: 'call_1' } });
    expect(p.moment).toBe('asking');
    expect(p.status).toBe('asking');
    expect(p.visual).toBe('idle');
    expect(p.interruptible).toBe(false);
  });

  it('asks a text question in its own words', () => {
    const p = presentOf(
      view({
        actions: [user('u1'), speak('s1'), askCall('c1', 'call_1', text)],
        phase: 'waiting',
        executions: [execution('e1', 'call_1', 'ask')],
      }),
    );
    expect(p.status).toBe('askingText');
  });

  it('stays open while narration after it plays, and Interrupt stays unavailable', () => {
    const line = speak('s2');
    const p = presentOf(
      view({
        actions: [...asked, line],
        phase: 'speaking',
        presented: line,
        executions: [execution('e1', 'call_1', 'ask')],
      }),
    );
    expect(p.moment).toBe('speaking');
    expect(p.ask?.mode).toBe('open');
    expect(p.composer).toBe('busy');
    expect(p.interruptible).toBe(false);
  });

  it('shows the answer as sent while narration or the continuation is still to come', () => {
    const line = speak('s2');
    const pending = [answered('r1', 'call_1', answer)];
    const speaking = presentOf(
      view({
        actions: [...asked, line],
        phase: 'speaking',
        presented: line,
        pendingResults: pending,
      }),
    );
    expect(speaking.ask).toEqual({ mode: 'sent', handle: 'call_1', input: choice, answer });
    expect(speaking.interruptible).toBe(true);
    const waiting = presentOf(view({ actions: asked, phase: 'waiting', pendingResults: pending }));
    expect(waiting.ask?.mode).toBe('sent');
  });

  it('gives way to the composer after an interrupt, after a generation failure, and while halted', () => {
    const pending = [answered('r1', 'call_1', answer)];
    const interrupted = presentOf(
      view({
        actions: [...asked, { type: 'interrupted', id: aid('i1') }],
        phase: 'idle',
        pendingResults: pending,
      }),
    );
    expect(interrupted.ask).toBeNull();
    expect(interrupted.composer).toBe('compose');

    const failed = presentOf(
      view({ actions: asked, phase: 'generationFailed', pendingResults: pending }),
    );
    expect(failed.ask).toBeNull();
    expect(failed.composer).toBe('retry');

    const halted = presentOf(
      view({
        actions: [...asked, faulted('f1', 'call_2', 'The show tool failed unexpectedly.')],
        phase: 'halted',
        executions: [execution('e1', 'call_1', 'ask')],
      }),
    );
    expect(halted.ask).toBeNull();
    expect(halted.composer).toBe('offline');
    expect(halted.fault).toBe('The show tool failed unexpectedly.');
    expect(halted.canGoBack).toBe(false);
  });
});

describe('interruptible', () => {
  it('is true while speaking or waiting with nothing blocking', () => {
    const line = speak('s1');
    expect(
      presentOf(view({ actions: [user('u1'), line], phase: 'speaking', presented: line }))
        .interruptible,
    ).toBe(true);
    expect(
      presentOf(
        view({
          actions: [user('u1'), speak('s1'), showCall('c1', 'call_1')],
          phase: 'waiting',
          executions: [execution('e1', 'call_1', 'show')],
        }),
      ).interruptible,
    ).toBe(true);
  });

  it('is false when idle', () => {
    expect(presentOf(view({ actions: [user('u1'), speak('s1')] })).interruptible).toBe(false);
  });
});

describe('canGoBack', () => {
  const [first, second] = [speak('s1'), speak('s2')];

  it('needs a speak before the presented one', () => {
    expect(
      presentOf(view({ actions: [user('u1'), first], phase: 'speaking', presented: first }))
        .canGoBack,
    ).toBe(false);
    expect(
      presentOf(
        view({ actions: [user('u1'), first, second], phase: 'speaking', presented: second }),
      ).canGoBack,
    ).toBe(true);
  });

  it('takes any speak when nothing is presented, including beside an open Ask', () => {
    expect(presentOf(view({ actions: [user('u1')] })).canGoBack).toBe(false);
    expect(presentOf(view({ actions: [user('u1'), first] })).canGoBack).toBe(true);
    expect(
      presentOf(
        view({ actions: asked, phase: 'waiting', executions: [execution('e1', 'call_1', 'ask')] }),
      ).canGoBack,
    ).toBe(true);
  });

  it('needs a connection', () => {
    expect(
      presentOf(view({ actions: [user('u1'), first] }), { connection: 'reconnecting' }).canGoBack,
    ).toBe(false);
  });
});

describe('an unresolved Show report', () => {
  const shown = [user('u1'), speak('s1'), showCall('c1', 'call_1')];
  const open = [execution('e1', 'call_1', 'show')];
  const unresolved = new Set([eid('e1')]);

  it('reads out of sync for as long as its execution stays open, across a phase change', () => {
    expect(
      presentOf(view({ actions: shown, phase: 'waiting', executions: open }), { unresolved })
        .status,
    ).toBe('outOfSync');
    const line = speak('s2');
    expect(
      presentOf(
        view({ actions: [...shown, line], phase: 'speaking', presented: line, executions: open }),
        { unresolved },
      ).status,
    ).toBe('outOfSync');
  });

  it('clears once the execution closes', () => {
    expect(presentOf(view({ actions: shown }), { unresolved }).status).toBe('complete');
  });

  it('gives way to a failed send', () => {
    const sendFailure = new TransportError({ reason: 'Unreachable' });
    expect(
      presentOf(view({ actions: shown, phase: 'waiting', executions: open }), {
        unresolved,
        sendFailure,
      }).status,
    ).toBe('sendUnreachable');
  });
});

describe('thinking and waiting after a continuation', () => {
  it('thinks about a submitted tool outcome until the new turn speaks', () => {
    const actions = [
      user('u1'),
      speak('s1'),
      showCall('c1', 'call_1'),
      errored('r1', 'call_1', 'show', 'The show could not be rendered: parse error'),
    ];
    const thinking = presentOf(view({ actions, phase: 'waiting' }));
    expect(thinking.moment).toBe('thinking');
    expect(thinking.status).toBe('thinking');
    expect(thinking.subtitle).toMatchObject({ key: 's1', tone: 'dim' });
    expect(rowOf(thinking.timeline, 'pending')).toEqual([{ kind: 'pending', label: 'Thinking…' }]);
    const more = presentOf(view({ actions: [...actions, speak('s2')], phase: 'waiting' }));
    expect(more.moment).toBe('waiting');
  });

  it('mulls over an answer to a question', () => {
    const p = presentOf(
      view({ actions: [...asked, answered('r1', 'call_1', answer)], phase: 'waiting' }),
    );
    expect(p.moment).toBe('thinking');
    expect(p.status).toBe('mulling');
  });

  it('still shows your message while thinking about it', () => {
    const p = presentOf(view({ actions: [user('u1', 'Hello')], phase: 'waiting' }));
    expect(p.status).toBe('thinking');
    expect(p.subtitle).toMatchObject({ key: 'u1', tone: 'you' });
  });
});

describe('timeline rows', () => {
  it('marks a Show that failed, and the one that corrected it', () => {
    const p = presentOf(
      view({
        actions: [
          user('u1'),
          showCall('c1', 'call_1', 'Flow'),
          errored('r1', 'call_1', 'show', 'Parse error on line 2'),
          showCall('c2', 'call_2', 'Flow'),
          showCall('c3', 'call_3', 'Recap'),
        ],
      }),
    );
    expect(
      rowOf(p.timeline, 'show').map(({ handle, failure, corrects }) => ({
        handle,
        failure,
        corrects,
      })),
    ).toEqual([
      { handle: 'call_1', failure: 'Parse error on line 2', corrects: false },
      { handle: 'call_2', failure: null, corrects: true },
      { handle: 'call_3', failure: null, corrects: false },
    ]);
  });

  it('knows a Show failed before its error is submitted', () => {
    const p = presentOf(
      view({
        actions: [user('u1'), showCall('c1', 'call_1'), showCall('c2', 'call_2')],
        phase: 'waiting',
        pendingResults: [errored('r1', 'call_1', 'show', 'Parse error')],
      }),
    );
    expect(rowOf(p.timeline, 'show').map((row) => [row.failure, row.corrects])).toEqual([
      ['Parse error', false],
      [null, true],
    ]);
  });

  it('shows where each question stands', () => {
    const p = presentOf(
      view({
        actions: [
          user('u1'),
          askCall('c1', 'call_1'),
          answered('r1', 'call_1', answer),
          askCall('c2', 'call_2', text),
          askCall('c3', 'call_3'),
          askCall('c4', 'call_4'),
          { type: 'interrupted', id: aid('i1') },
        ],
        executions: [execution('e3', 'call_3', 'ask')],
        pendingResults: [answered('r2', 'call_2', { kind: 'text', text: 'A browser' }, text)],
      }),
    );
    expect(
      rowOf(p.timeline, 'ask').map(({ handle, state, answer: a }) => [handle, state, a]),
    ).toEqual([
      ['call_1', 'answered', answer],
      ['call_2', 'pending', { kind: 'text', text: 'A browser' }],
      ['call_3', 'live', null],
      ['call_4', 'unanswered', null],
    ]);
  });

  it('says an invalid call went back to the model only once its error is submitted', () => {
    const invalid = call('c1', 'call_1', 'diagram', { source: 'x' });
    const error = errored(
      'r1',
      'call_1',
      'diagram',
      'Unknown tool "diagram". Available types: speak, show, ask.',
    );
    const correctionOf = (v: ConversationView) => rowOf(presentOf(v).timeline, 'invalidCall')[0];

    // Not reached yet: no error, and nothing is claimed.
    expect(correctionOf(view({ actions: [user('u1'), invalid], phase: 'waiting' }))).toMatchObject({
      error: null,
      correction: null,
    });
    // Queued: on its way.
    expect(
      correctionOf(
        view({ actions: [user('u1'), invalid], phase: 'waiting', pendingResults: [error] }),
      ),
    ).toMatchObject({ error: error.message, correction: 'pending' });
    // In the log: the model has it.
    expect(correctionOf(view({ actions: [user('u1'), invalid, error] }))).toEqual({
      kind: 'invalidCall',
      id: 'c1',
      handle: 'call_1',
      tool: 'diagram',
      error: error.message,
      correction: 'sent',
    });
  });

  it('never promises a correction for an error still pending when the session halted', () => {
    const halted = presentOf(
      view({
        actions: [
          user('u1'),
          call('c1', 'call_1', 'diagram', {}),
          faulted('f1', 'call_2', 'The show tool failed.'),
        ],
        phase: 'halted',
        pendingResults: [errored('r1', 'call_1', 'diagram', 'Unknown tool "diagram".')],
      }),
    );
    expect(rowOf(halted.timeline, 'invalidCall')[0]).toMatchObject({
      error: 'Unknown tool "diagram".',
      correction: null,
    });
    expect(rowOf(halted.timeline, 'faulted')).toEqual([
      { kind: 'faulted', id: 'f1', message: 'The show tool failed.' },
    ]);
  });

  it('gives tool outcomes no row of their own', () => {
    const p = presentOf(view({ actions: [...asked, answered('r1', 'call_1', answer)] }));
    expect(p.timeline.map((row) => row.kind)).not.toContain('tool_result');
    expect(p.timeline).toHaveLength(3);
  });

  it('puts the now marker on the presented line, behind the cursor after Back', () => {
    const [first, second] = [speak('s1'), speak('s2')];
    const playing: PlaybackStatus = { kind: 'playing', actionId: 's1' };
    const p = presentOf(
      view({ actions: [user('u1'), first, second], phase: 'speaking', presented: first }),
      { playback: playing },
    );
    expect(rowOf(p.timeline, 'speak').map((row) => row.now)).toEqual(['playing', null]);
    expect(p.subtitle).toMatchObject({ key: 's1', tone: 'current' });
  });
});

describe('a failed Show on the way back to the model', () => {
  const failed = [user('u1'), showCall('c1', 'call_1')];
  const error = errored('r1', 'call_1', 'show', 'Parse error');
  const reporting = [execution('e1', 'call_1', 'show')];

  it('is pending while it is reported, and while its error waits to be submitted', () => {
    expect(
      showCorrectionOf(
        view({ actions: failed, phase: 'waiting', executions: reporting }),
        'call_1',
        none,
      ),
    ).toEqual({ error: 'pending', awaited: true });
    expect(
      showCorrectionOf(
        view({ actions: failed, phase: 'waiting', pendingResults: [error] }),
        'call_1',
        none,
      ),
    ).toEqual({ error: 'pending', awaited: true });
  });

  it('is sent once its error is in the log, awaiting a replacement while the turn goes on', () => {
    expect(
      showCorrectionOf(view({ actions: [...failed, error], phase: 'waiting' }), 'call_1', none),
    ).toEqual({
      error: 'sent',
      awaited: true,
    });
  });

  it('awaits nothing once the turn is over without a newer Show', () => {
    expect(
      showCorrectionOf(
        view({ actions: [...failed, error, speak('s1')], phase: 'idle' }),
        'call_1',
        none,
      ),
    ).toEqual({ error: 'sent', awaited: false });
    // Interrupted before submission: the error goes with whatever comes next.
    expect(
      showCorrectionOf(
        view({
          actions: [...failed, { type: 'interrupted', id: aid('i1') }],
          phase: 'idle',
          pendingResults: [error],
        }),
        'call_1',
        none,
      ),
    ).toEqual({ error: 'pending', awaited: false });
  });

  it('awaits nothing in a later turn the listener started', () => {
    const later = [...failed, error, speak('s1'), user('u2', 'Something else'), speak('s2')];
    expect(showCorrectionOf(view({ actions: later, phase: 'waiting' }), 'call_1', none)).toEqual({
      error: 'sent',
      awaited: false,
    });
    const line = speak('s3');
    expect(
      showCorrectionOf(
        view({ actions: [...later, line], phase: 'speaking', presented: line }),
        'call_1',
        none,
      ),
    ).toEqual({ error: 'sent', awaited: false });
    // Submitted only with the listener's next message, after an interrupt: that turn answers the message.
    expect(
      showCorrectionOf(
        view({
          actions: [...failed, { type: 'interrupted', id: aid('i1') }, user('u2'), error],
          phase: 'waiting',
        }),
        'call_1',
        none,
      ),
    ).toEqual({ error: 'sent', awaited: false });
  });

  it('promises nothing when the report was not accepted, for an older Show, or after a halt', () => {
    const waiting = view({ actions: failed, phase: 'waiting', executions: reporting });
    expect(showCorrectionOf(waiting, 'call_1', new Set([eid('e1')]))).toBeNull();
    expect(
      showCorrectionOf(
        view({ actions: [...failed, error, showCall('c2', 'call_2')] }),
        'call_1',
        none,
      ),
    ).toBeNull();
    expect(
      showCorrectionOf(
        view({
          actions: [...failed, error, faulted('f1', 'call_2', 'The show tool failed.')],
          phase: 'halted',
        }),
        'call_1',
        none,
      ),
    ).toBeNull();
  });
});
