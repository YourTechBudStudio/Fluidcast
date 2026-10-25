import { describe, expect, it } from 'vitest';

import type {
  TranscriptEntry,
  WorkerStatus,
  WorkerSummary,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { activityLine, pulseKey, workerActivity } from './activity';
import type { WorkersConnection, WorkersFeed } from './state';
import { activityTone, TOOL_TONES, toolTone } from './tone';

const prompt: TranscriptEntry = {
  _tag: 'prompt',
  parentToolUseId: null,
  source: 'fluidcast',
  text: 'Do it',
};
const thinking = (
  parent: string | null = null,
): Extract<TranscriptEntry, { _tag: 'thinking' }> => ({
  _tag: 'thinking',
  parentToolUseId: parent,
  summary: '',
});
const call = (
  id: string,
  name = 'Bash',
  parent: string | null = null,
): Extract<TranscriptEntry, { _tag: 'toolCall' }> => ({
  _tag: 'toolCall',
  parentToolUseId: parent,
  toolUseId: id,
  name,
  input: JSON.stringify({ command: 'pnpm   test' }),
  truncated: false,
});
const result = (id: string, parent: string | null = null): TranscriptEntry => ({
  _tag: 'toolResult',
  parentToolUseId: parent,
  toolUseId: id,
  content: 'ok',
  truncated: false,
  isError: false,
});
const turnEnd: TranscriptEntry = { _tag: 'turnEnd', parentToolUseId: null, outcome: 'success' };

const feed = <A>(data: A | undefined, connection: WorkersConnection = 'live'): WorkersFeed<A> => ({
  data,
  connection,
});
const worker = (status: WorkerStatus = 'working', backgroundTasks = 0) =>
  feed<WorkerSummary>({ _tag: 'WorkerSummary', status, sessionId: 's', backgroundTasks });
const activity = (entries: ReadonlyArray<TranscriptEntry>, summary = worker()) =>
  workerActivity(summary, feed(entries));

describe('workerActivity', () => {
  it('shows the latest top-level event, keyed by its position', () => {
    expect(activity([prompt, thinking(), call('a')])).toEqual({
      kind: 'entry',
      entry: call('a'),
      key: '2',
    });
  });

  it('skips results and subagent steps', () => {
    const entries = [
      prompt,
      call('a', 'Agent'),
      thinking('a'),
      call('b', 'Read', 'a'),
      result('a'),
    ];
    expect(activity(entries)).toMatchObject({ kind: 'entry', key: '1' });
  });

  it('shows nothing before the turn’s first event', () => {
    expect(activity([])).toBeNull();
    expect(activity([prompt, call('a'), turnEnd, prompt])).toBeNull();
    expect(activity([prompt, call('a', 'Agent'), thinking('a')])).toMatchObject({ key: '1' });
    expect(activity([call('a'), prompt, call('b', 'Read', 'a')])).toBeNull();
  });

  it('counts background tasks once the main turn ended, else shows nothing', () => {
    expect(activity([prompt, call('a'), turnEnd], worker('working', 2))).toEqual({
      kind: 'background',
      count: 2,
    });
    expect(activity([prompt, call('a'), turnEnd], worker('working', 0))).toBeNull();
    // A background task's own steps do not bring the ended turn back.
    expect(activity([prompt, turnEnd, thinking('a')], worker('working', 1))).toEqual({
      kind: 'background',
      count: 1,
    });
  });

  it('shows nothing unless both feeds are live and the worker works', () => {
    const entries = [prompt, call('a')];
    expect(activity(entries, worker('idle'))).toBeNull();
    expect(activity(entries, worker('failed'))).toBeNull();
    expect(workerActivity({ ...worker(), connection: 'reconnecting' }, feed(entries))).toBeNull();
    expect(workerActivity(worker(), feed(entries, 'reconnecting'))).toBeNull();
    expect(
      workerActivity(worker(), feed<ReadonlyArray<TranscriptEntry>>(undefined, 'connecting')),
    ).toBeNull();
  });
});

describe('pulseKey', () => {
  it('advances on every entry, subagent steps included', () => {
    const entries = [prompt, call('a', 'Agent')];
    expect(pulseKey([...entries, thinking('a')])).toBeGreaterThan(pulseKey(entries));
    expect(pulseKey(undefined)).toBe(0);
  });
});

describe('activityLine', () => {
  it('names tools as they come, with their short input', () => {
    expect(activityLine({ kind: 'entry', entry: call('a', 'commandExecution'), key: '0' })).toEqual(
      { label: 'commandExecution', detail: 'pnpm test', thinking: false },
    );
  });

  it('marks thinking, with its summary when there is one', () => {
    expect(activityLine({ kind: 'entry', entry: thinking(), key: '0' })).toEqual({
      label: 'Thinking',
      detail: '',
      thinking: true,
    });
  });

  it('collapses written text to one line', () => {
    const entry = { _tag: 'text', parentToolUseId: null, text: 'One\n\ntwo  three' } as const;
    expect(activityLine({ kind: 'entry', entry, key: '0' }).detail).toBe('One two three');
  });

  it('counts background tasks, singular for one', () => {
    expect(activityLine({ kind: 'background', count: 1 }).label).toBe('1 background task running');
    expect(activityLine({ kind: 'background', count: 3 }).label).toBe('3 background tasks running');
  });
});

describe('tones', () => {
  it('gives a tool name the same tone every time', () => {
    expect(toolTone('Bash')).toBe(toolTone('Bash'));
    expect(TOOL_TONES).toContain(toolTone('commandExecution'));
  });

  it('spreads tool names across the tones', () => {
    const names = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Agent', 'WebFetch'];
    const extra = Array.from({ length: 60 }, (_, i) => `tool${i}`);
    const used = new Set([...names, ...extra].map(toolTone));
    expect(used.size).toBe(TOOL_TONES.length);
  });

  it('reserves violet for thinking and mutes everything else that is not a tool', () => {
    expect(activityTone({ kind: 'entry', entry: thinking(), key: '0' })).toBe('violet');
    expect(activityTone({ kind: 'background', count: 1 })).toBe('fg-muted');
    const status = { _tag: 'status', parentToolUseId: null, text: 'Working' } as const;
    expect(activityTone({ kind: 'entry', entry: status, key: '0' })).toBe('fg-muted');
    expect(TOOL_TONES).not.toContain('violet');
  });
});
