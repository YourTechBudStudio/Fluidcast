// MOCK ONLY. Invented data shaped like `tool-agent/schema` (program-design §5.2). Nothing here is real.

export type WorkerStatus = 'working' | 'done' | 'failed';

export interface WorkerSummary {
  readonly agent: string;
  readonly agentType: string;
  readonly status: WorkerStatus;
  readonly sessionId: string;
}

type Parent = { readonly parentToolUseId: string | null };

export type TranscriptEntry =
  | ({
      readonly _tag: 'prompt';
      readonly source: 'fluidcast' | 'earlier';
      readonly text: string;
    } & Parent)
  | ({ readonly _tag: 'text'; readonly text: string } & Parent)
  | ({
      readonly _tag: 'toolCall';
      readonly toolUseId: string;
      readonly name: string;
      readonly input: string;
      readonly truncated: boolean;
    } & Parent)
  | ({
      readonly _tag: 'toolResult';
      readonly toolUseId: string;
      readonly content: string;
      readonly truncated: boolean;
      readonly isError: boolean;
    } & Parent)
  | ({ readonly _tag: 'status'; readonly text: string } & Parent)
  | ({
      readonly _tag: 'turnEnd';
      readonly outcome: string;
      readonly resetsAt?: number | undefined;
    } & Parent);

const top = { parentToolUseId: null } as const;
const sub = (id: string) => ({ parentToolUseId: id }) as const;
const json = (value: unknown) => JSON.stringify(value);

const handoff1 = `You are working with a listener through Fluidcast, a voice interface. An interface agent speaks with the listener, shows them material, and asks them questions; it hands you their words and its own. This is your first message in this conversation.

<conversation_since_last_message>
**Interface agent:** Morning. You wanted to settle how the client should retry when the event stream drops. Want me to lay out the two options first?

**Listener:** Yes, but keep it short. I mostly care about what happens on a phone going through a tunnel.

**Interface agent:** Two designs are on the table. Design A retries on a fixed schedule and replays from the last cursor. Design B waits for the browser's online event and resubscribes from scratch.

**Shown to the user** (markdown) — "Two retry designs"
| | Design A | Design B |
| --- | --- | --- |
| Trigger | Timer, 1 s → 30 s | \`online\` event |
| Resume | From cursor | Fresh snapshot |

**Listener:** B feels simpler. But does a fresh snapshot lose the line that was playing?
</conversation_since_last_message>

<instruction>
Compare Design A and Design B against the current reconnect flow in packages/client. Focus on the listener's question: does B lose the line that was playing? Recommend one.
</instruction>

The listener's own words take precedence over the interface agent's summary of them.

Rules:
- You work unattended. Nobody can answer you mid-task; put questions in your response.
- Do not use AskUserQuestion.
- If the conversation above misrepresents something, say so plainly.
- Work in the foreground only.

Your response goes back to the interface agent, which presents it to the listener.`;

const handoff2 = `The conversation since your last message:

<conversation_since_last_message>
**Interface agent:** It's reading the client's transport now. So far it looks like —
*(the listener interrupted)*

**Listener:** Actually, forget B entirely. Assume A and tell me what the backoff cap should be for a phone.
</conversation_since_last_message>

<instruction>
The listener dropped Design B. Assume Design A and recommend a backoff cap for mobile.
</instruction>

The listener's own words take precedence over the interface agent's summary of them.`;

const transportSource = `import { Effect, Schedule, Stream } from 'effect';
import * as Sse from '@fluidcast/app-contract/sse';

/**
 * The page's one subscription to /api/events. A dropped stream is retried by the caller;
 * this module only frames events and maps transport failures.
 */
export const subscribe = (after: number | null) =>
  Sse.stream(eventsPath(after)).pipe(
    Stream.mapEffect(Sse.decodeDataSchema(SessionEventJson)),
    Stream.mapError(toTransportError),
  );

const eventsPath = (after: number | null) =>
  after === null ? '/api/events' : \`/api/events?after=\${after}\`;

export const toTransportError = (cause: unknown): TransportError =>
  cause instanceof HttpClientError.ResponseError
    ? new TransportError({ reason: 'Status', status: cause.response.status })
    : new TransportError({ reason: 'Network' });`;

const grepResult = `packages/client/src/runtime.ts:41:    Stream.retry(Schedule.spaced('2 seconds')),
packages/client/src/runtime.ts:88:  // Resubscribing replays from the last applied event, so nothing is lost.
packages/client/src/view.ts:112:  readonly connection: 'live' | 'reconnecting' | 'offline';
packages/harness/src/session/protocol.ts:203:/** Events after \`after\` are replayed on resubscribe, in order. */
apps/web/src/client/transport.ts:27:    Stream.retry(Schedule.exponential('500 millis').pipe(Schedule.upTo('30 seconds'))),`;

const testFailure = `> @yourtechbudstudio/fluidcast-client@0.0.0 test
> vitest run reconnect

 FAIL  src/runtime.test.ts > reconnect > resumes the playing line after a drop
AssertionError: expected 'line_12' to be 'line_11'
 ❯ src/runtime.test.ts:214:31
    212|     yield* drop(connection);
    213|     yield* resume(connection);
    214|     expect(view.current?.id).toBe('line_11');
       |                               ^
    215|   }));

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)`;

const recommendation = `## Short answer

**Design B does lose the playing line.** A fresh snapshot starts at the log's end, and the client treats the line that was playing as already heard. Design A resumes from the cursor, so the line plays again from its start.

## Against today's reconnect flow

| | Design A | Design B |
| --- | --- | --- |
| Playing line after a drop | Replayed from its start | Skipped |
| Phone in a tunnel (30–90 s) | Retries every 1 → 30 s, resumes at once | Waits for \`online\`, then a full snapshot |
| New code | Retry schedule only | Snapshot path + online listener |

Today's client already replays from \`after\` (\`runtime.ts:88\`), so **A is mostly already built**. The failing test above is the one gap: after a drop the view jumps one line ahead.

## Recommendation

Take **Design A**. Fix the off-by-one in \`resume\` so the cursor points at the line that was playing, not the next one.

One question for the listener: should a replayed line restart from the beginning, or from roughly where it was cut?`;

/** The live worker: two hand-offs, one folded into the running turn, a subagent, and a tool still running. */
const brainstorm: TranscriptEntry[] = [
  { _tag: 'prompt', source: 'fluidcast', text: handoff1, ...top },
  {
    _tag: 'text',
    text: "I'll read how the client reconnects today before comparing the two designs.",
    ...top,
  },
  {
    _tag: 'toolCall',
    toolUseId: 't1',
    name: 'Read',
    input: json({ file_path: 'packages/client/src/transport.ts' }),
    truncated: false,
    ...top,
  },
  {
    _tag: 'toolResult',
    toolUseId: 't1',
    content: transportSource,
    truncated: false,
    isError: false,
    ...top,
  },
  {
    _tag: 'toolCall',
    toolUseId: 't2',
    name: 'Grep',
    input: json({ pattern: 'retry|resubscribe|after', path: 'packages', output_mode: 'content' }),
    truncated: false,
    ...top,
  },
  {
    _tag: 'toolResult',
    toolUseId: 't2',
    content: grepResult,
    truncated: false,
    isError: false,
    ...top,
  },
  {
    _tag: 'toolCall',
    toolUseId: 't3',
    name: 'Agent',
    input: json({
      description: 'Trace resume after a dropped stream',
      subagent_type: 'Explore',
      prompt:
        'Trace what the client does between a dropped /api/events stream and the next applied event. Report which line the view considers current afterwards.',
    }),
    truncated: false,
    ...top,
  },
  { _tag: 'status', text: 'Reading the SSE framing in app-contract', ...sub('t3') },
  {
    _tag: 'toolCall',
    toolUseId: 't3a',
    name: 'Read',
    input: json({ file_path: 'packages/client/src/runtime.ts' }),
    truncated: false,
    ...sub('t3'),
  },
  {
    _tag: 'toolResult',
    toolUseId: 't3a',
    content: '…(runtime.ts, 214 lines)…',
    truncated: false,
    isError: false,
    ...sub('t3'),
  },
  {
    _tag: 'toolCall',
    toolUseId: 't3b',
    name: 'Grep',
    input: json({ pattern: 'cursor', path: 'packages/client/src' }),
    truncated: false,
    ...sub('t3'),
  },
  {
    _tag: 'toolResult',
    toolUseId: 't3b',
    content: 'packages/client/src/runtime.ts:92:  cursor: state.cursor + 1,',
    truncated: false,
    isError: false,
    ...sub('t3'),
  },
  { _tag: 'status', text: 'Found where the cursor advances on resume', ...sub('t3') },
  {
    _tag: 'text',
    text: 'On resume, `runtime.ts:92` sets `cursor: state.cursor + 1`. The line that was playing counts as heard, so the view starts at the **next** line.',
    ...sub('t3'),
  },
  {
    _tag: 'toolResult',
    toolUseId: 't3',
    content:
      'agentId: a7f3c21\nOn resume the cursor advances by one (runtime.ts:92), so the line that was playing is treated as heard. Resubscribing replays events after `after`, which is correct; the off-by-one is in how the cursor is restored.',
    truncated: false,
    isError: false,
    ...top,
  },
  {
    _tag: 'toolCall',
    toolUseId: 't4',
    name: 'Bash',
    input: json({
      command: 'pnpm --filter @yourtechbudstudio/fluidcast-client test -- reconnect',
      description: 'Run the reconnect tests',
    }),
    truncated: false,
    ...top,
  },
  {
    _tag: 'toolResult',
    toolUseId: 't4',
    content: testFailure,
    truncated: false,
    isError: true,
    ...top,
  },
  { _tag: 'text', text: recommendation, ...top },
  { _tag: 'turnEnd', outcome: 'success', ...top },
  { _tag: 'prompt', source: 'fluidcast', text: handoff2, ...top },
  {
    _tag: 'text',
    text: 'Dropping B. For a phone, the cap matters most in tunnels and lifts, so let me check what the web client does today.',
    ...top,
  },
  {
    _tag: 'toolCall',
    toolUseId: 't5',
    name: 'Read',
    input: json({ file_path: 'apps/web/src/client/transport.ts', offset: 20, limit: 20 }),
    truncated: false,
    ...top,
  },
  {
    _tag: 'toolResult',
    toolUseId: 't5',
    content: `    Stream.retry(Schedule.exponential('500 millis').pipe(Schedule.upTo('30 seconds'))),`,
    truncated: false,
    isError: false,
    ...top,
  },
  {
    _tag: 'toolCall',
    toolUseId: 't6',
    name: 'WebSearch',
    input: json({ query: 'mobile network reconnect backoff cap tunnel typical outage duration' }),
    truncated: false,
    ...top,
  },
];

const done: TranscriptEntry[] = [
  ...brainstorm,
  {
    _tag: 'toolResult',
    toolUseId: 't6',
    content:
      'Web search results for "mobile network reconnect backoff cap…"\n1. Designing for flaky mobile networks — most outages under 60 s…\n2. Exponential backoff and jitter — cap at 30–60 s for interactive apps…',
    truncated: false,
    isError: false,
    ...top,
  },
  {
    _tag: 'text',
    text: "Keep the cap at **30 seconds**, but add jitter and retry at once on the browser's `online` event. Most tunnel outages end within a minute, and 30 s keeps the worst-case wait after signal returns short.",
    ...top,
  },
  { _tag: 'turnEnd', outcome: 'success', ...top },
];

const failed: TranscriptEntry[] = [
  ...brainstorm,
  {
    _tag: 'toolResult',
    toolUseId: 't6',
    content: 'Search failed: request timed out.',
    truncated: false,
    isError: true,
    ...top,
  },
  { _tag: 'turnEnd', outcome: 'error_max_turns', ...top },
];

const longDiff = Array.from(
  { length: 140 },
  (_, i) =>
    `${i % 7 === 0 ? '+' : ' '} line ${i + 1}: ${'const x = compute(input);'.slice(0, 18 + (i % 9))}`,
).join('\n');

/** A preloaded worker: history from before Fluidcast attached (no turn outcomes), then one Fluidcast turn. */
const review: TranscriptEntry[] = [
  {
    _tag: 'prompt',
    source: 'earlier',
    text: 'Review the retry changes on feat/reconnect before I open a PR. Be picky about the test coverage.',
    ...top,
  },
  { _tag: 'text', text: "I'll start with the diff against main.", ...top },
  {
    _tag: 'toolCall',
    toolUseId: 'r1',
    name: 'Bash',
    input: json({ command: 'git diff main...feat/reconnect', description: 'Show the branch diff' }),
    truncated: false,
    ...top,
  },
  {
    _tag: 'toolResult',
    toolUseId: 'r1',
    content: longDiff.slice(0, 4000),
    truncated: true,
    isError: false,
    ...top,
  },
  {
    _tag: 'text',
    text: 'Two findings:\n\n1. `resume` has no test for a drop **during** a line.\n2. The retry schedule is duplicated in `runtime.ts` and the web transport.',
    ...top,
  },
  { _tag: 'prompt', source: 'earlier', text: 'Good. Fix the first one.', ...top },
  {
    _tag: 'toolCall',
    toolUseId: 'r2',
    name: 'Edit',
    input: json({
      file_path: 'packages/client/src/runtime.test.ts',
      old_string: "  it('resumes after a drop', …",
      new_string: "  it('resumes after a drop', …\n  it('replays the line that was playing', …",
    }),
    truncated: false,
    ...top,
  },
  {
    _tag: 'toolResult',
    toolUseId: 'r2',
    content: 'The file packages/client/src/runtime.test.ts has been updated.',
    truncated: false,
    isError: false,
    ...top,
  },
  { _tag: 'text', text: 'Added the test. It fails today, which is the bug.', ...top },
  {
    _tag: 'prompt',
    source: 'fluidcast',
    text: `You are working with a listener through Fluidcast, a voice interface. …

<conversation_since_last_message>
**Listener:** Can the reviewer tell me whether the new test covers the tunnel case?
</conversation_since_last_message>

<instruction>
Does the test you added cover a drop that lasts longer than the retry cap?
</instruction>`,
    ...top,
  },
  {
    _tag: 'text',
    text: 'Not yet. It drops for one retry interval. I would add a second case that holds the stream down for **45 s** under a test clock.',
    ...top,
  },
  { _tag: 'turnEnd', outcome: 'success', ...top },
];

/** What the working worker writes next, one entry per "Worker writes more" click. */
export const LIVE_APPEND: ReadonlyArray<TranscriptEntry> = [
  {
    _tag: 'toolResult',
    toolUseId: 't6',
    content:
      'Web search results for "mobile network reconnect backoff cap…"\n1. Designing for flaky mobile networks — most outages under 60 s…\n2. Exponential backoff and jitter — cap at 30–60 s for interactive apps…',
    truncated: false,
    isError: false,
    ...top,
  },
  {
    _tag: 'text',
    text: 'Most tunnel outages end within a minute, so a 30 s cap looks right. Let me confirm the web client adds jitter.',
    ...top,
  },
  {
    _tag: 'toolCall',
    toolUseId: 't7',
    name: 'Grep',
    input: JSON.stringify({ pattern: 'jitter', path: 'apps/web/src' }),
    truncated: false,
    ...top,
  },
];

const SESSION_IDS = {
  brainstorm: '0199a3f2-7c41-7e2b-9d4a-5be81c3f19ab',
  review: '0199a1c8-02de-7a10-b3f7-e4c65d0a7731',
} as const;

export type MockState =
  | 'working'
  | 'done'
  | 'failed'
  | 'earlier'
  | 'empty'
  | 'connecting'
  | 'reconnecting'
  | 'notFound';

export const MOCK_STATES: ReadonlyArray<{ readonly value: MockState; readonly label: string }> = [
  { value: 'working', label: 'Working' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed turn' },
  { value: 'earlier', label: 'Preloaded' },
  { value: 'empty', label: 'No workers' },
  { value: 'connecting', label: 'Connecting' },
  { value: 'reconnecting', label: 'Reconnecting' },
  { value: 'notFound', label: 'Not found' },
];

export interface MockScene {
  readonly workers: ReadonlyArray<WorkerSummary>;
  /** The worker selected by default: the target of the latest agent call in the main transcript. */
  readonly latest: string | null;
  readonly transcripts: Readonly<Record<string, ReadonlyArray<TranscriptEntry>>>;
  readonly connection: 'connecting' | 'live' | 'reconnecting' | 'notFound';
}

export const sceneFor = (state: MockState): MockScene => {
  const status: WorkerStatus =
    state === 'done' ? 'done' : state === 'failed' ? 'failed' : 'working';
  const workers: WorkerSummary[] = [
    { agent: 'review', agentType: 'claude', status: 'done', sessionId: SESSION_IDS.review },
    { agent: 'brainstorm', agentType: 'claude', status, sessionId: SESSION_IDS.brainstorm },
  ];
  const transcripts = {
    review,
    brainstorm: state === 'done' ? done : state === 'failed' ? failed : brainstorm,
  };
  switch (state) {
    case 'empty':
      return { workers: [], latest: null, transcripts: {}, connection: 'live' };
    case 'connecting':
      return { workers, latest: 'brainstorm', transcripts, connection: 'connecting' };
    case 'reconnecting':
      return { workers, latest: 'brainstorm', transcripts, connection: 'reconnecting' };
    case 'notFound':
      return { workers, latest: 'brainstorm', transcripts, connection: 'notFound' };
    case 'earlier':
      return { workers, latest: 'review', transcripts, connection: 'live' };
    default:
      return { workers, latest: 'brainstorm', transcripts, connection: 'live' };
  }
};
