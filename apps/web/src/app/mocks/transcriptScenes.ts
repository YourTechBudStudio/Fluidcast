// MOCK ONLY. The main transcript at five moments of one conversation (program-design §9.1 rows). Invented data.

import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { sceneFor, type TranscriptEntry } from './fixtures';

type AgentState = 'working' | 'answered' | 'failed';

export type MockRow =
  | { readonly kind: 'user'; readonly id: string; readonly text: string }
  | {
      readonly kind: 'speak';
      readonly id: string;
      readonly text: string;
      readonly continued: boolean;
      readonly interrupted?: boolean;
    }
  | { readonly kind: 'interrupted'; readonly id: string; readonly during: 'speech' | 'wait' }
  | {
      readonly kind: 'show';
      readonly id: string;
      readonly handle: string;
      readonly input: ShowInput;
    }
  | {
      readonly kind: 'agent';
      readonly id: string;
      readonly handle: string;
      readonly agent: string;
      readonly agentType: string;
      readonly message: string;
      readonly state: AgentState;
      /** Other calls the same busy period covers; one result answers them all. */
      readonly together: ReadonlyArray<string>;
      /** This call joined a busy worker instead of starting one. */
      readonly joined: boolean;
    }
  | {
      readonly kind: 'progress';
      readonly id: string;
      readonly agent: string;
      readonly text: string;
    }
  | {
      /** The `tool_result` or `tool_errored` the model read, at the point in the log where it was delivered. */
      readonly kind: 'agentResult';
      readonly id: string;
      readonly handles: ReadonlyArray<string>;
      readonly agent: string;
      readonly agentType: string;
      /**
       * `result`: `AgentResult.messages`, the worker's top-level text messages in order. `error`: `agentErrorParts` of
       * the `tool_errored` message; `written` is everything the worker wrote as one text (not separable into messages).
       */
      readonly outcome:
        | { readonly _tag: 'result'; readonly messages: ReadonlyArray<string> }
        | { readonly _tag: 'error'; readonly error: string; readonly written: string | null };
    };

/** The worker's top-level text messages, the same entries the Workers layer shows, so both views agree. */
const topTexts = (entries: ReadonlyArray<TranscriptEntry>) =>
  entries.flatMap((e) => (e._tag === 'text' && e.parentToolUseId === null ? [e.text] : []));

const doneEntries = sceneFor('done').transcripts['brainstorm'] ?? [];
const failedEntries = sceneFor('failed').transcripts['brainstorm'] ?? [];
const firstTurn = failedEntries.slice(
  0,
  failedEntries.findIndex((e) => e._tag === 'turnEnd'),
);

export type TranscriptScene = 'working' | 'interruptedWait' | 'steered' | 'answered' | 'failed';

export const TRANSCRIPT_SCENES: ReadonlyArray<{
  readonly value: TranscriptScene;
  readonly label: string;
}> = [
  { value: 'working', label: 'Working' },
  { value: 'interruptedWait', label: 'Interrupted (wait)' },
  { value: 'steered', label: 'Steered' },
  { value: 'answered', label: 'Answered' },
  { value: 'failed', label: 'Failed' },
];

interface SceneFooter {
  /** `thinking`: "Thinking · m:ss" and Interrupt. Otherwise the given copy and Send. */
  readonly thinking: boolean;
  readonly copy: string;
}

const show: ShowInput = {
  format: 'markdown',
  title: 'Two retry designs',
  content: `| | Design A | Design B |
| --- | --- | --- |
| Trigger | Timer, 1 s → 30 s | \`online\` event |
| Resume | From cursor | Fresh snapshot |
| Phone in a tunnel | Retries, resumes at once | Waits, then reloads |`,
};

const opening: MockRow[] = [
  {
    kind: 'user',
    id: 'u1',
    text: 'Help me settle how the client should retry when the event stream drops.',
  },
  {
    kind: 'speak',
    id: 's1',
    text: 'Sure. There are two designs on the table, and they differ mostly in what happens on a phone.',
    continued: false,
  },
  {
    kind: 'speak',
    id: 's2',
    text: 'Design A retries on a fixed schedule and replays from the last cursor. Design B waits for the',
    continued: true,
    interrupted: true,
  },
  { kind: 'interrupted', id: 'i1', during: 'speech' },
  { kind: 'user', id: 'u2', text: 'Keep it short. I care about a phone in a tunnel.' },
  { kind: 'speak', id: 's3', text: 'Got it. Here they are side by side.', continued: false },
  { kind: 'show', id: 'sh1', handle: 'call_1', input: show },
  {
    kind: 'speak',
    id: 's4',
    text: 'The real question is whether B loses the line that was playing. I’ll have a worker check the code.',
    continued: true,
  },
];

const call3 = (state: AgentState, together: string[] = []): MockRow => ({
  kind: 'agent',
  id: 'a3',
  handle: 'call_3',
  agent: 'brainstorm',
  agentType: 'claude',
  message:
    'Compare Design A and Design B against the current reconnect flow in packages/client. Focus on whether B loses the line that was playing. Recommend one.',
  state,
  together,
  joined: false,
});

const call7 = (state: AgentState): MockRow => ({
  kind: 'agent',
  id: 'a7',
  handle: 'call_7',
  agent: 'brainstorm',
  agentType: 'claude',
  message: 'The listener dropped Design B. Assume Design A and recommend a backoff cap for mobile.',
  state,
  together: ['call_3'],
  joined: true,
});

const handedOff: MockRow[] = [
  {
    kind: 'speak',
    id: 's5',
    text: 'I’ve asked the brainstorm worker to dig in. I’ll tell you what it finds.',
    continued: false,
  },
  {
    kind: 'progress',
    id: 'p1',
    agent: 'brainstorm',
    text: 'Reading how the client reconnects in packages/client/src/transport.ts',
  },
  {
    kind: 'speak',
    id: 's6',
    text: 'It’s reading how the client reconnects today.',
    continued: false,
  },
  {
    kind: 'progress',
    id: 'p2',
    agent: 'brainstorm',
    text: 'Tracing where the cursor moves after a dropped stream',
  },
  {
    kind: 'speak',
    id: 's7',
    text: 'Now it’s tracing where playback resumes after a drop.',
    continued: false,
  },
];

const steer = (state: AgentState): MockRow[] => [
  { kind: 'interrupted', id: 'i2', during: 'wait' },
  {
    kind: 'user',
    id: 'u3',
    text: 'Actually, forget B entirely. Assume A and tell me what the backoff cap should be for a phone.',
  },
  {
    kind: 'speak',
    id: 's8',
    text: 'Okay, I’ll pass that on. It can fold it into what it’s doing.',
    continued: false,
  },
  call7(state),
];

export const transcriptSceneFor = (
  scene: TranscriptScene,
): { readonly rows: ReadonlyArray<MockRow>; readonly footer: SceneFooter } => {
  switch (scene) {
    case 'working':
      return {
        rows: [...opening, call3('working'), ...handedOff],
        footer: { thinking: true, copy: '' },
      };
    case 'interruptedWait':
      return {
        rows: [
          ...opening,
          call3('working'),
          ...handedOff,
          { kind: 'interrupted', id: 'i2', during: 'wait' },
        ],
        footer: { thinking: false, copy: 'Okay, I’m listening.' },
      };
    case 'steered':
      return {
        rows: [...opening, call3('working', ['call_7']), ...handedOff, ...steer('working')],
        footer: { thinking: true, copy: '' },
      };
    case 'answered':
      return {
        rows: [
          ...opening,
          call3('answered', ['call_7']),
          ...handedOff,
          ...steer('answered'),
          {
            kind: 'agentResult',
            id: 'r3',
            handles: ['call_3', 'call_7'],
            agent: 'brainstorm',
            agentType: 'claude',
            outcome: { _tag: 'result', messages: topTexts(doneEntries) },
          },
          {
            kind: 'speak',
            id: 's9',
            text: 'It’s back. First, B would have lost the playing line: a fresh snapshot treats it as already heard.',
            continued: false,
          },
          {
            kind: 'speak',
            id: 's10',
            text: 'So A it is. For a phone, keep the cap at thirty seconds, add jitter, and retry the moment the signal returns.',
            continued: true,
          },
        ],
        footer: { thinking: false, copy: 'Your turn.' },
      };
    case 'failed':
      return {
        rows: [
          ...opening,
          call3('failed'),
          ...handedOff.slice(0, 3),
          {
            kind: 'agentResult',
            id: 'r3-failed',
            handles: ['call_3'],
            agent: 'brainstorm',
            agentType: 'claude',
            outcome: {
              _tag: 'error',
              error: 'The worker “brainstorm” stopped with an error (error_max_turns).',
              written: topTexts(firstTurn).join('\n\n'),
            },
          },
          {
            kind: 'speak',
            id: 's9',
            text: 'The worker ran out of steps before it finished. It did find that B skips the playing line. Want me to have it try a narrower question?',
            continued: false,
          },
        ],
        footer: { thinking: false, copy: 'Over to you.' },
      };
  }
};
