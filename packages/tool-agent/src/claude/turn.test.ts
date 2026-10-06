import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import {
  background,
  init,
  rateLimit,
  result,
  say,
  state,
  toolResults,
  assistant,
  toolUse,
} from './frames.test.ts';
import { initialTurnState, step, type TrackerInput, type TrackerOutput } from './turn.ts';

type Input = SDKMessage | { readonly elapsed: number };

/** Runs inputs in order and returns every output, with the final state. */
const track = (inputs: ReadonlyArray<Input>, newSession = false) => {
  let current = initialTurnState(newSession);
  const outputs: Array<TrackerOutput> = [];
  for (const input of inputs) {
    const tracked: TrackerInput =
      'elapsed' in input
        ? { _tag: 'GraceElapsed', grace: input.elapsed }
        : { _tag: 'Frame', frame: input };
    const [next, produced] = step(current, tracked);
    current = next;
    outputs.push(...produced);
  }
  return { state: current, outputs };
};

/** The outputs without transcript entries. */
const signals = (outputs: ReadonlyArray<TrackerOutput>) =>
  outputs.filter((output) => output._tag !== 'Entry');

const settled = { _tag: 'Settled' } as const;

describe('turn tracker', () => {
  it('settles once when a result is followed by idle', () => {
    const { outputs } = track([
      state('running'),
      say('Done.', ['m1']),
      result({ consumed: ['m1'] }),
      state('idle'),
      state('idle'),
    ]);
    assert.deepEqual(signals(outputs), [
      { _tag: 'Consumed', ids: ['m1'] },
      { _tag: 'Consumed', ids: ['m1'] },
      settled,
    ]);
  });

  it('waits for background work, cancels grace for the automatic turn and settles after its result', () => {
    const { outputs } = track([
      state('running'),
      background('task_1'),
      result({ consumed: ['m1'] }),
      state('idle'),
      background(),
      state('running'),
      say('The background task finished.'),
      result(),
      state('idle'),
    ]);
    assert.deepEqual(signals(outputs), [
      { _tag: 'Consumed', ids: ['m1'] },
      { _tag: 'StartGrace', grace: 1 },
      { _tag: 'CancelGrace' },
      settled,
    ]);
  });

  it('settles on grace when the background set empties and no turn starts', () => {
    const { outputs } = track([
      state('running'),
      background('task_1'),
      result(),
      state('idle'),
      background(),
      { elapsed: 1 },
    ]);
    assert.deepEqual(signals(outputs), [{ _tag: 'StartGrace', grace: 1 }, settled]);
  });

  it('ignores a stale grace timer', () => {
    const { outputs } = track([
      state('running'),
      background('task_1'),
      result(),
      state('idle'),
      background(),
      state('running'),
      background('task_2'),
      result(),
      state('idle'),
      background(),
      // The first timer, cancelled but already queued, must not settle the second turn early.
      { elapsed: 1 },
    ]);
    assert.deepEqual(signals(outputs), [
      { _tag: 'StartGrace', grace: 1 },
      { _tag: 'CancelGrace' },
      { _tag: 'StartGrace', grace: 2 },
    ]);
    assert.deepEqual(signals(track([{ elapsed: 0 }]).outputs), []);
  });

  it('ignores ambient background tasks', () => {
    const { outputs } = track([
      state('running'),
      background({ id: 'monitor', ambient: true }),
      result(),
      state('idle'),
    ]);
    assert.deepEqual(signals(outputs), [settled]);
  });

  it('reports only what a pure-text turn consumed, leaving a later message out', () => {
    const { outputs } = track([
      state('running'),
      say('Answer to the first message.', ['m1']),
      result({ consumed: ['m1'] }),
      state('idle'),
    ]);
    const consumed = outputs.filter((output) => output._tag === 'Consumed');
    assert.deepEqual(consumed, [
      { _tag: 'Consumed', ids: ['m1'] },
      { _tag: 'Consumed', ids: ['m1'] },
    ]);
    assert.ok(outputs.some((output) => output._tag === 'Settled'));
  });

  it('falls back to user_message_uuid and sends no empty Consumed', () => {
    assert.deepEqual(signals(track([state('running'), result({ consumedOne: 'm1' })]).outputs), [
      { _tag: 'Consumed', ids: ['m1'] },
    ]);
    assert.deepEqual(signals(track([say('Hello.')]).outputs), []);
  });

  it('does not settle while the session requires action', () => {
    const { outputs } = track([state('running'), result(), state('requires_action')]);
    assert.deepEqual(signals(outputs), []);
  });

  it('ends a turn that saw a rejected rate-limit event as usage_limit, and forgets it after', () => {
    const { outputs } = track([
      state('running'),
      rateLimit('rejected', 1_790_000_000),
      result({ subtype: 'error_during_execution' }),
      state('idle'),
      state('running'),
      result({ subtype: 'error_during_execution' }),
    ]);
    const ends = outputs.flatMap((output) =>
      output._tag === 'Entry' && output.entry._tag === 'turnEnd' ? [output.entry] : [],
    );
    assert.deepEqual(ends, [
      { _tag: 'turnEnd', parentToolUseId: null, outcome: 'usage_limit', resetsAt: 1_790_000_000 },
      { _tag: 'turnEnd', parentToolUseId: null, outcome: 'error_during_execution' },
    ]);
  });

  it('forgets a rate-limit event when a new turn starts', () => {
    const { outputs } = track([
      rateLimit('rejected'),
      state('running'),
      rateLimit('allowed'),
      result({ subtype: 'error_max_turns' }),
    ]);
    assert.deepEqual(
      outputs.filter((output) => output._tag === 'Entry').map((output) => output.entry),
      [{ _tag: 'turnEnd', parentToolUseId: null, outcome: 'error_max_turns' }],
    );
  });

  it('turns a startup failure result into its turn end, then a fault, and never settles', () => {
    const { outputs } = track([
      result({ subtype: 'error_during_execution', startupFailure: 'cwd_unavailable' }),
      state('idle'),
    ]);
    assert.deepEqual(outputs.slice(0, 2), [
      {
        _tag: 'Entry',
        entry: { _tag: 'turnEnd', parentToolUseId: null, outcome: 'error_during_execution' },
      },
      { _tag: 'Fault', fault: new ToolFault({ reason: 'ClaudeStartup' }) },
    ]);
  });

  it('yields entries before the fault of an auth error', () => {
    const { outputs } = track([
      assistant([{ type: 'text', text: 'Please sign in.' }], { error: 'authentication_failed' }),
    ]);
    assert.deepEqual(
      outputs.map((output) => output._tag),
      ['Entry', 'Fault'],
    );
  });

  it('yields entries for tool calls and results in frame order', () => {
    const { outputs } = track([
      assistant([toolUse('call_1', 'Read', { file_path: 'notes.md' })]),
      toolResults([{ type: 'tool_result', tool_use_id: 'call_1', content: 'Notes.' }]),
    ]);
    assert.deepEqual(
      outputs.map((output) => (output._tag === 'Entry' ? output.entry._tag : output._tag)),
      ['toolCall', 'toolResult'],
    );
  });

  it("reports a new session's ID from its first init frame, before any entry", () => {
    const sessionId = 'b0a1c2d3-0000-4000-8000-000000000001';
    const { outputs, state: last } = track(
      [init(sessionId), state('running'), say('Hi.'), init('another-id')],
      true,
    );
    assert.deepEqual(
      outputs.map((output) => (output._tag === 'Entry' ? output.entry._tag : output._tag)),
      ['SessionStarted', 'text'],
    );
    assert.deepEqual(outputs[0], { _tag: 'SessionStarted', sessionId });
    assert.equal(last.reportSession, false);
  });

  it("reports nothing for a resumed session's init frame", () => {
    const { outputs } = track([init('b0a1c2d3-0000-4000-8000-000000000001')], false);
    assert.deepEqual(outputs, []);
  });
});
