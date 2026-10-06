import { describe, expect, it } from 'vitest';

import { TransportError } from '@yourtechbudstudio/fluidcast-client';
import type { ActionId, Speak } from '@yourtechbudstudio/fluidcast-core/actions';
import type { Execution, ExecutionId } from '@yourtechbudstudio/fluidcast-harness/protocol';
import { forwardToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import type { AskCommand, AskInput } from '@yourtechbudstudio/fluidcast-tool-ask/schema';

import type { PlaybackStatus } from '../playback';
import type { Action, Connection, ConversationView } from './model';
import { present, type TimelineRow } from './presentation';
import { showCorrectionOf } from './tools';

// Fixtures: a view is built from its actions, like the Client SDK's projection.

type Handles = readonly [string, ...string[]];

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
    handles: [handle],
    tool: 'ask',
    result: { question: input.question, answer },
  }) as const;
const errored = (id: string, handle: string, tool: string, message: string) =>
  ({ type: 'tool_errored', id: aid(id), handles: [handle], tool, message }) as const;
const faulted = (id: string, handle: string, message: string): Action => ({
  type: 'tool_faulted',
  id: aid(id),
  handles: [handle],
  tool: 'show',
  error: { tag: 'UnexpectedError', message },
});
const execution = (
  id: string,
  handle: string,
  tool: string,
  startedAt = 0,
  handles: Handles = [handle],
): Execution => ({
  executionId: eid(id),
  handles,
  tool,
  blocking: tool === 'ask',
  startedAt,
});
const forwardCall = (id: string, handle: string) => call(id, handle, forwardToolName, {});
const forwardResult = (id: string, handles: Handles, messages: readonly string[]) =>
  ({
    type: 'tool_result',
    id: aid(id),
    handles,
    tool: forwardToolName,
    result: { messages: [...messages] },
  }) as const;
const forwardErrored = (id: string, handles: Handles, message: string) =>
  ({ type: 'tool_errored', id: aid(id), handles, tool: forwardToolName, message }) as const;
const progressOf = (id: string, handle: string, line: string): Action => ({
  type: 'tool_progress',
  id: aid(id),
  handles: [handle],
  tool: forwardToolName,
  text: line,
});

const view = (partial: Partial<ConversationView>): ConversationView => ({
  actions: [],
  phase: 'idle',
  speakers: [{ id: 'host', name: 'Host' }],
  executions: [],
  pendingResults: [],
  start: null,
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
    expect(p.ask).toMatchObject({
      mode: 'open',
      input: choice,
      execution: { handles: ['call_1'] },
    });
    expect(p.moment).toBe('asking');
    expect(p.status).toBe('asking');
    expect(p.visual).toBe('idle');
    // Esc interrupts an open question, closing it unanswered, like the Ask card's Interrupt.
    expect(p.interruptible).toBe(true);
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

  it('stays open while narration after it plays, and Interrupt stays available', () => {
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
    expect(p.interruptible).toBe(true);
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
    const waiting = presentOf(view({ actions: asked, phase: 'working', pendingResults: pending }));
    expect(waiting.ask?.mode).toBe('sent');
  });

  it('gives way to the composer after an interrupt, after a generation failure, and while halted', () => {
    const pending = [answered('r1', 'call_1', answer)];
    const interrupted = presentOf(
      view({
        actions: [...asked, { type: 'interrupted', id: aid('i1'), during: 'wait' }],
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
          phase: 'working',
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
      presentOf(view({ actions: shown, phase: 'working', executions: open }), { unresolved })
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
      presentOf(view({ actions: shown, phase: 'working', executions: open }), {
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
    const thinking = presentOf(view({ actions, phase: 'working' }));
    expect(thinking.moment).toBe('thinking');
    expect(thinking.status).toBe('thinking');
    expect(thinking.subtitle).toMatchObject({ key: 's1', tone: 'dim' });
    expect(rowOf(thinking.timeline, 'pending')).toEqual([{ kind: 'pending', label: 'Thinking…' }]);
    const more = presentOf(view({ actions: [...actions, speak('s2')], phase: 'working' }));
    expect(more.moment).toBe('waiting');
  });

  it('thinks about an answer to a question like anything else', () => {
    const p = presentOf(
      view({ actions: [...asked, answered('r1', 'call_1', answer)], phase: 'working' }),
    );
    expect(p.moment).toBe('thinking');
    expect(p.status).toBe('thinking');
  });

  it('still shows your message while thinking about it', () => {
    const p = presentOf(view({ actions: [user('u1', 'Hello')], phase: 'working' }));
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
        phase: 'working',
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
          { type: 'interrupted', id: aid('i1'), during: 'wait' },
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
    expect(correctionOf(view({ actions: [user('u1'), invalid], phase: 'working' }))).toMatchObject({
      error: null,
      correction: null,
    });
    // Queued: on its way.
    expect(
      correctionOf(
        view({ actions: [user('u1'), invalid], phase: 'working', pendingResults: [error] }),
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
        view({ actions: failed, phase: 'working', executions: reporting }),
        'call_1',
        none,
      ),
    ).toEqual({ error: 'pending', awaited: true });
    expect(
      showCorrectionOf(
        view({ actions: failed, phase: 'working', pendingResults: [error] }),
        'call_1',
        none,
      ),
    ).toEqual({ error: 'pending', awaited: true });
  });

  it('is sent once its error is in the log, awaiting a replacement while the turn goes on', () => {
    expect(
      showCorrectionOf(view({ actions: [...failed, error], phase: 'working' }), 'call_1', none),
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
          actions: [...failed, { type: 'interrupted', id: aid('i1'), during: 'wait' }],
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
    expect(showCorrectionOf(view({ actions: later, phase: 'working' }), 'call_1', none)).toEqual({
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
          actions: [
            ...failed,
            { type: 'interrupted', id: aid('i1'), during: 'wait' },
            user('u2'),
            error,
          ],
          phase: 'working',
        }),
        'call_1',
        none,
      ),
    ).toEqual({ error: 'sent', awaited: false });
  });

  it('promises nothing when the report was not accepted, for an older Show, or after a halt', () => {
    const waiting = view({ actions: failed, phase: 'working', executions: reporting });
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

describe('working and interrupts', () => {
  it('asks only while a blocking tool waits; otherwise working reads as thinking or more coming', () => {
    const asking = presentOf(
      view({ actions: asked, phase: 'waiting', executions: [execution('e1', 'call_1', 'ask')] }),
    );
    expect(asking.moment).toBe('asking');
    const shown = [user('u1'), showCall('c1', 'call_1')];
    const open = [execution('e1', 'call_1', 'show')];
    expect(presentOf(view({ actions: shown, phase: 'working', executions: open })).moment).toBe(
      'thinking',
    );
    expect(
      presentOf(view({ actions: [...shown, speak('s1')], phase: 'working', executions: open }))
        .moment,
    ).toBe('waiting');
  });

  it('starts a new turn at a used progress update', () => {
    const progress: Action = {
      type: 'tool_progress',
      id: aid('p1'),
      handles: ['call_1'],
      tool: 'show',
      text: 'Still rendering.',
    };
    const actions = [user('u1'), speak('s1'), showCall('c1', 'call_1'), progress];
    const p = presentOf(
      view({ actions, phase: 'working', executions: [execution('e1', 'call_1', 'show')] }),
    );
    expect(p.moment).toBe('thinking');
    // Progress and context add no timeline row yet.
    const context: Action = { type: 'tool_context', id: aid('x1'), tool: 'show', text: 'busy' };
    const rows = presentOf(view({ actions: [...actions, context], phase: 'working' })).timeline;
    expect(rows.map((row) => row.kind)).toEqual(['user', 'speak', 'show', 'pending']);
  });

  it('marks a line as cut only when the interrupt cut its speech', () => {
    const cut = presentOf(
      view({
        actions: [
          user('u1'),
          speak('s1'),
          { type: 'interrupted', id: aid('i1'), during: 'speech' },
        ],
      }),
    );
    expect(rowOf(cut.timeline, 'speak')[0]?.interrupted).toBe(true);
    expect(rowOf(cut.timeline, 'interrupted')).toEqual([
      { kind: 'interrupted', id: 'i1', during: 'speech' },
    ]);
    expect(cut.subtitle).toMatchObject({ key: 's1', interrupted: true });

    const cutIn = presentOf(
      view({
        actions: [user('u1'), speak('s1'), { type: 'interrupted', id: aid('i1'), during: 'wait' }],
      }),
    );
    expect(rowOf(cutIn.timeline, 'speak')[0]?.interrupted).toBe(false);
    expect(rowOf(cutIn.timeline, 'interrupted')).toEqual([
      { kind: 'interrupted', id: 'i1', during: 'wait' },
    ]);
    expect(cutIn.subtitle).toMatchObject({ key: 's1', interrupted: false });
  });
});

describe('the Forward tool', () => {
  const handed = [user('u1'), forwardCall('c1', 'call_1'), speak('s1', 'Let me look.')];

  it('thinks while the worker runs, whatever else goes on, counting from the Forward execution', () => {
    const executions = [
      execution('e1', 'call_1', forwardToolName, 5_000),
      execution('e0', 'call_0', 'show', 1_000),
    ];
    // After a spoken line: still thinking, not "more coming", and the line stays dimmed.
    const afterSpeak = presentOf(view({ actions: handed, phase: 'working', executions }));
    expect(afterSpeak.moment).toBe('thinking');
    expect(afterSpeak.status).toBe('thinking');
    // An earlier open Show does not count; only the Forward execution does.
    expect(afterSpeak.thinkingSince).toBe(5_000);
    expect(afterSpeak.subtitle).toMatchObject({ key: 's1', tone: 'dim' });
    // With results from another tool queued.
    const queued = presentOf(
      view({
        actions: handed,
        phase: 'working',
        executions: [execution('e1', 'call_1', forwardToolName, 5_000)],
        pendingResults: [errored('r0', 'call_0', 'show', 'The show could not be rendered.')],
      }),
    );
    expect(queued.moment).toBe('thinking');
    // While the voice model generates (a progress iteration), before it speaks.
    const generating = presentOf(
      view({
        actions: [...handed, progressOf('p1', 'call_1', "I'm reading the designs.")],
        phase: 'working',
        executions: [execution('e1', 'call_1', forwardToolName, 5_000)],
      }),
    );
    expect(generating.moment).toBe('thinking');
  });

  it('has no elapsed start without a running worker, or outside thinking', () => {
    const noWorker = presentOf(view({ actions: [user('u1')], phase: 'working' }));
    expect(noWorker.moment).toBe('thinking');
    expect(noWorker.thinkingSince).toBeNull();
    const speaking = presentOf(
      view({
        actions: handed,
        phase: 'speaking',
        executions: [execution('e1', 'call_1', forwardToolName, 5_000)],
      }),
    );
    expect(speaking.moment).toBe('speaking');
    expect(speaking.thinkingSince).toBeNull();
  });

  it('shows where each forward stands, and which forwards share an execution or a result', () => {
    const actions = [
      user('u1'),
      forwardCall('c1', 'call_1'),
      user('u2'),
      // The model added a stray field: still a forward.
      call('c2', 'call_2', forwardToolName, { task: 'stray' }),
      forwardCall('c3', 'call_3'),
      forwardCall('c4', 'call_4'),
    ];
    const p = presentOf(
      view({
        actions,
        phase: 'working',
        executions: [execution('e1', 'call_1', forwardToolName, 0, ['call_1', 'call_2'])],
        pendingResults: [
          forwardErrored('r3', ['call_3'], 'The work stopped with an error (error_max_turns).'),
        ],
      }),
    );
    expect(
      rowOf(p.timeline, 'forward').map(({ handle, state, joined, together }) => ({
        handle,
        state,
        joined,
        together,
      })),
    ).toEqual([
      { handle: 'call_1', state: 'working', joined: false, together: ['call_2'] },
      { handle: 'call_2', state: 'working', joined: true, together: ['call_1'] },
      { handle: 'call_3', state: 'failed', joined: false, together: [] },
      // No execution and no outcome: after a halt, for example.
      { handle: 'call_4', state: null, joined: false, together: [] },
    ]);

    const shared = presentOf(
      view({
        actions: [...actions.slice(0, 4), forwardResult('r1', ['call_1', 'call_2'], ['Done.'])],
      }),
    );
    expect(
      rowOf(shared.timeline, 'forward').map(({ state, joined, together }) => ({
        state,
        joined,
        together,
      })),
    ).toEqual([
      { state: 'answered', joined: false, together: ['call_2'] },
      { state: 'answered', joined: true, together: ['call_1'] },
    ]);
  });

  it('puts one result row per forward outcome where the model read it, with every call it answers', () => {
    const p = presentOf(
      view({
        actions: [
          user('u1'),
          forwardCall('c1', 'call_1'),
          forwardCall('c2', 'call_2'),
          forwardResult(
            'r1',
            ['call_1', 'call_2'],
            ['First, the designs.', 'Then, the conclusion.'],
          ),
          speak('s1', 'I found two things.'),
        ],
      }),
    );
    expect(p.timeline.map((row) => row.kind)).toEqual([
      'user',
      'forward',
      'forward',
      'forwardResult',
      'speak',
    ]);
    expect(rowOf(p.timeline, 'forwardResult')).toEqual([
      {
        kind: 'forwardResult',
        id: 'r1',
        handles: ['call_1', 'call_2'],
        outcome: { _tag: 'result', messages: ['First, the designs.', 'Then, the conclusion.'] },
      },
    ]);
  });

  it('gives a pending outcome no result row until the model reads it', () => {
    const p = presentOf(
      view({
        actions: [user('u1'), forwardCall('c1', 'call_1')],
        phase: 'working',
        pendingResults: [forwardResult('r1', ['call_1'], ['Done.'])],
      }),
    );
    expect(rowOf(p.timeline, 'forwardResult')).toEqual([]);
    expect(rowOf(p.timeline, 'forward')[0]?.state).toBe('answered');
  });

  it('splits a failed busy period into the error and what the worker wrote', () => {
    const message =
      'The work stopped with an error (error_max_turns).\n\nWhat was written before stopping:\n\nFirst.\n\nSecond.';
    const p = presentOf(
      view({
        actions: [
          user('u1'),
          forwardCall('c1', 'call_1'),
          forwardErrored('r1', ['call_1'], message),
        ],
      }),
    );
    expect(rowOf(p.timeline, 'forwardResult')[0]?.outcome).toEqual({
      _tag: 'error',
      error: 'The work stopped with an error (error_max_turns).',
      written: 'First.\n\nSecond.',
    });
    const silent = presentOf(
      view({
        actions: [
          user('u1'),
          forwardCall('c1', 'call_1'),
          forwardErrored(
            'r1',
            ['call_1'],
            'The work stopped with an error (error_during_execution).',
          ),
        ],
      }),
    );
    expect(rowOf(silent.timeline, 'forwardResult')[0]?.outcome).toEqual({
      _tag: 'error',
      error: 'The work stopped with an error (error_during_execution).',
      written: null,
    });
  });

  it('shows a result that does not decode as its JSON text', () => {
    const odd = {
      type: 'tool_result',
      id: aid('r1'),
      handles: ['call_1'],
      tool: forwardToolName,
      result: { unexpected: true },
    } as const;
    const p = presentOf(view({ actions: [user('u1'), forwardCall('c1', 'call_1'), odd] }));
    expect(rowOf(p.timeline, 'forwardResult')[0]?.outcome).toEqual({
      _tag: 'result',
      messages: [JSON.stringify({ unexpected: true }, null, 2)],
    });
  });

  it('shows progress, and no row for tool context', () => {
    const context: Action = {
      type: 'tool_context',
      id: aid('x1'),
      tool: forwardToolName,
      text: 'Your work is in progress.',
    };
    const p = presentOf(
      view({
        actions: [
          user('u1'),
          forwardCall('c1', 'call_1'),
          context,
          progressOf('p1', 'call_1', "I'm reading the designs."),
        ],
        phase: 'working',
        executions: [execution('e1', 'call_1', forwardToolName)],
      }),
    );
    expect(p.timeline.map((row) => row.kind)).toEqual(['user', 'forward', 'progress', 'pending']);
    expect(rowOf(p.timeline, 'progress')).toEqual([
      { kind: 'progress', id: 'p1', text: "I'm reading the designs." },
    ]);
  });
});

describe('a preloaded start', () => {
  const message = { type: 'user_message', id: aid('m1'), text: 'Walk me through it.' } as const;
  const context = {
    type: 'context',
    id: aid('x1'),
    label: 'My last answer',
    text: 'SECRET-CONTEXT',
  } as const;

  it('waits for Tap to start, previewing its message, with the composer off', () => {
    const p = presentOf(view({ phase: 'ready', start: { message, context } }));
    expect(p.moment).toBe('ready');
    expect(p.status).toBe('ready');
    expect(p.composer).toBe('offline');
    expect(p.visual).toBe('idle');
    expect(p.interruptible).toBe(false);
    expect(p.canGoBack).toBe(false);
    expect(p.subtitle).toEqual({
      key: 'preloaded:m1',
      text: '“Walk me through it.”',
      tone: 'you',
      label: 'Preloaded · Tap to start says',
    });
    expect(p.timeline).toEqual([
      { kind: 'preloaded', id: 'm1', text: 'Walk me through it.', contextLabel: 'My last answer' },
    ]);
    // The context's text is for the model only.
    expect(JSON.stringify(p.timeline)).not.toContain('SECRET-CONTEXT');
  });

  it('marks no context label when the start has none', () => {
    const p = presentOf(view({ phase: 'ready', start: { message, context: null } }));
    expect(rowOf(p.timeline, 'preloaded')).toEqual([
      { kind: 'preloaded', id: 'm1', text: 'Walk me through it.', contextLabel: null },
    ]);
  });

  it('becomes an ordinary message once sent, and its context makes no row', () => {
    const p = presentOf(view({ actions: [context, message], phase: 'working' }));
    expect(p.timeline).toEqual([
      { kind: 'user', id: 'm1', text: 'Walk me through it.' },
      { kind: 'pending', label: 'Thinking…' },
    ]);
    expect(p.subtitle).toMatchObject({ key: 'm1', tone: 'you' });
  });
});
