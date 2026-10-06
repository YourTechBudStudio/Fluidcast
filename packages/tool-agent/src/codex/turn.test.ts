import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  agentMessage,
  command,
  itemCompleted,
  itemStarted,
  main,
  rateLimits,
  reasoning,
  spawn,
  status,
  subagentStarted,
  turnCompleted,
  turnStarted,
  userMessage,
} from './frames.test.ts';
import type { Notification } from './protocol.ts';
import { initialTurnState, step, type TrackerOutput } from './turn.ts';

/** Runs notifications through the tracker from a fresh state, collecting every output. */
const run = (notifications: ReadonlyArray<Notification>) => {
  let state = initialTurnState(main);
  const outputs: Array<TrackerOutput> = [];
  for (const notification of notifications) {
    const [next, out] = step(state, notification);
    state = next;
    outputs.push(...out);
  }
  return { state, outputs };
};

const tags = (outputs: ReadonlyArray<TrackerOutput>) =>
  outputs.map((output) => (output._tag === 'Entry' ? `Entry:${output.entry._tag}` : output._tag));

describe('step', () => {
  it('reports a main-thread user message with a client ID as consumed, once', () => {
    const { outputs } = run([
      itemStarted(userMessage('m1')),
      itemCompleted(userMessage('m1')),
      itemStarted(userMessage(null)),
      itemStarted(userMessage('m2'), 'thread-child'),
    ]);
    assert.deepEqual(outputs, [{ _tag: 'Consumed', ids: ['m1'] }]);
  });

  it('skips live reasoning with string content and maps what follows', () => {
    const { outputs } = run([
      turnStarted(),
      itemStarted(reasoning()),
      itemCompleted(reasoning()),
      itemCompleted(agentMessage('Done.')),
    ]);
    assert.deepEqual(outputs, [
      { _tag: 'Entry', entry: { _tag: 'text', parentToolUseId: null, text: 'Done.' } },
    ]);
  });

  it('settles on turn completion after idle, in either order, and not before', () => {
    const idleFirst = run([
      turnStarted(),
      status('active'),
      itemCompleted(agentMessage('Done.')),
      status('idle'),
      turnCompleted(),
    ]);
    assert.deepEqual(tags(idleFirst.outputs), [
      'Entry:text',
      'Entry:turnEnd',
      'MainTurnCompleted',
      'Settled',
    ]);
    const completedFirst = run([turnStarted(), status('active'), turnCompleted(), status('idle')]);
    assert.deepEqual(tags(completedFirst.outputs), [
      'Entry:turnEnd',
      'MainTurnCompleted',
      'Settled',
    ]);
    const stillActive = run([turnStarted(), status('active'), turnCompleted()]);
    assert.ok(!tags(stillActive.outputs).includes('Settled'));
  });

  it('settles after a failed turn that leaves the thread in systemError', () => {
    const { outputs } = run([
      turnStarted(),
      status('active'),
      status('systemError'),
      turnCompleted(main, 'failed', { httpConnectionFailed: { httpStatusCode: 401 } }),
    ]);
    assert.deepEqual(outputs.slice(0, 1), [
      {
        _tag: 'Entry',
        entry: { _tag: 'turnEnd', parentToolUseId: null, outcome: 'httpConnectionFailed' },
      },
    ]);
    assert.deepEqual(tags(outputs), ['Entry:turnEnd', 'MainTurnCompleted', 'Settled']);
  });

  it('waits for a busy subagent that outlives the main turn', () => {
    const { outputs } = run([
      turnStarted(),
      status('active'),
      itemStarted(spawn('call-spawn', ['thread-child'], 'inProgress')),
      itemCompleted(spawn('call-spawn', ['thread-child'])),
      status('idle'),
      turnCompleted(),
      turnStarted('thread-child'),
      itemCompleted(agentMessage('Found it.', 'item-child'), 'thread-child'),
      turnCompleted('thread-child'),
    ]);
    assert.deepEqual(tags(outputs), [
      'Entry:toolCall',
      'Entry:toolResult',
      'Entry:turnEnd',
      'MainTurnCompleted',
      'Entry:text',
      'Settled',
    ]);
    assert.deepEqual(outputs[4], {
      _tag: 'Entry',
      entry: { _tag: 'text', parentToolUseId: 'call-spawn', text: 'Found it.' },
    });
  });

  it('treats a started subAgentActivity as the spawn: busy, and nesting under it', () => {
    const { outputs } = run([
      turnStarted(),
      itemStarted(subagentStarted('call-start', 'thread-child')),
      itemCompleted(subagentStarted('call-start', 'thread-child')),
      status('idle'),
      turnCompleted(),
      turnStarted('thread-child'),
      itemCompleted(agentMessage('pong', 'item-child'), 'thread-child'),
      itemCompleted({
        type: 'subAgentActivity',
        id: 'done',
        kind: 'completed',
        agentThreadId: 'thread-child',
        agentPath: '/root/explorer',
      }),
      turnCompleted('thread-child'),
    ]);
    assert.deepEqual(tags(outputs), [
      'Entry:toolCall',
      'Entry:toolResult',
      'Entry:turnEnd',
      'MainTurnCompleted',
      'Entry:text',
      'Settled',
    ]);
    assert.deepEqual(outputs[4], {
      _tag: 'Entry',
      entry: { _tag: 'text', parentToolUseId: 'call-start', text: 'pong' },
    });
  });

  it('does not mark a subagent busy at its spawn when its turn already completed', () => {
    const { outputs, state } = run([
      turnStarted(),
      turnStarted('thread-child'),
      turnCompleted('thread-child'),
      itemCompleted(spawn('call-spawn', ['thread-child'])),
      status('idle'),
      turnCompleted(),
    ]);
    assert.equal(state.subagents.get('thread-child'), false);
    assert.equal(tags(outputs).at(-1), 'Settled');
  });

  it('marks a spawned subagent busy until its turn frames say otherwise', () => {
    const { outputs } = run([
      turnStarted(),
      itemCompleted(spawn('call-spawn', ['thread-child'])),
      status('idle'),
      turnCompleted(),
    ]);
    assert.ok(!tags(outputs).includes('Settled'));
  });

  it("nests a subagent's entries under its own thread ID until its spawn call is known", () => {
    const { outputs } = run([
      turnStarted(),
      turnStarted('thread-child'),
      itemCompleted(agentMessage('Early.', 'item-early'), 'thread-child'),
      itemCompleted(spawn('call-spawn', ['thread-child'])),
      itemCompleted(agentMessage('Later.', 'item-later'), 'thread-child'),
    ]);
    const texts = outputs.flatMap((output) =>
      output._tag === 'Entry' && output.entry._tag === 'text' ? [output.entry] : [],
    );
    assert.deepEqual(texts, [
      { _tag: 'text', parentToolUseId: 'thread-child', text: 'Early.' },
      { _tag: 'text', parentToolUseId: 'call-spawn', text: 'Later.' },
    ]);
  });

  it('settles again after a late entry arrives once settled', () => {
    const { outputs } = run([
      turnStarted(),
      itemStarted(command('cmd-bg', { status: 'inProgress' })),
      status('idle'),
      turnCompleted(),
      itemCompleted(command('cmd-bg', { output: 'done' })),
      status('idle'),
    ]);
    assert.deepEqual(tags(outputs), [
      'Entry:toolCall',
      'Entry:turnEnd',
      'MainTurnCompleted',
      'Settled',
      'Entry:toolResult',
      'Settled',
    ]);
  });

  it('starts over on the next main turn', () => {
    const { outputs } = run([
      turnStarted(),
      status('idle'),
      turnCompleted(),
      turnStarted(),
      status('active'),
      status('idle'),
    ]);
    assert.deepEqual(tags(outputs), ['Entry:turnEnd', 'MainTurnCompleted', 'Settled']);
  });

  it('records outcomes uninterpreted, with resetsAt only on a usage limit with a full window', () => {
    const outcome = (notifications: ReadonlyArray<Notification>) =>
      run(notifications).outputs.find(
        (output) => output._tag === 'Entry' && output.entry._tag === 'turnEnd',
      );
    assert.deepEqual(outcome([turnStarted(), turnCompleted(main, 'interrupted')]), {
      _tag: 'Entry',
      entry: { _tag: 'turnEnd', parentToolUseId: null, outcome: 'interrupted' },
    });
    assert.deepEqual(
      outcome([
        turnStarted(),
        rateLimits(100, 100),
        turnCompleted(main, 'failed', 'usageLimitExceeded'),
      ]),
      {
        _tag: 'Entry',
        entry: {
          _tag: 'turnEnd',
          parentToolUseId: null,
          outcome: 'usageLimitExceeded',
          resetsAt: 1_900_000_000,
        },
      },
    );
    assert.deepEqual(
      outcome([
        turnStarted(),
        rateLimits(100, 40),
        turnCompleted(main, 'failed', 'usageLimitExceeded'),
      ]),
      {
        _tag: 'Entry',
        entry: {
          _tag: 'turnEnd',
          parentToolUseId: null,
          outcome: 'usageLimitExceeded',
          resetsAt: 1_800_000_000,
        },
      },
    );
    assert.deepEqual(
      outcome([
        turnStarted(),
        rateLimits(90, 40),
        turnCompleted(main, 'failed', 'usageLimitExceeded'),
      ]),
      {
        _tag: 'Entry',
        entry: { _tag: 'turnEnd', parentToolUseId: null, outcome: 'usageLimitExceeded' },
      },
    );
    assert.deepEqual(
      outcome([
        turnStarted(),
        rateLimits(100, 100),
        turnCompleted(main, 'failed', 'serverOverloaded'),
      ]),
      {
        _tag: 'Entry',
        entry: { _tag: 'turnEnd', parentToolUseId: null, outcome: 'serverOverloaded' },
      },
    );
    assert.deepEqual(outcome([turnStarted(), turnCompleted(main, 'failed', null)]), {
      _tag: 'Entry',
      entry: { _tag: 'turnEnd', parentToolUseId: null, outcome: 'failed' },
    });
  });

  it('gives a subagent turn no turnEnd, and ignores unknown or malformed notifications', () => {
    const { outputs } = run([
      turnStarted('thread-child'),
      turnCompleted('thread-child', 'failed', 'other'),
      { method: 'thread/tokenUsage/updated', params: { threadId: main } },
      { method: 'item/completed', params: { threadId: main } },
    ]);
    assert.deepEqual(outputs, []);
  });
});
