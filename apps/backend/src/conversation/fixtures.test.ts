/** Test-only builders and fakes (named `.test.ts` so builds leave it out; it has no tests). */
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { Context, Effect, Layer, Schema, type Scope, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { routes, SessionStatusJson, StartFailed, type StartRequest } from '@fluidcast/app-contract';
import { SpeechSynthesizer } from '@yourtechbudstudio/fluidcast-core/speech';
import { layer as harnessLayer, Session } from '@yourtechbudstudio/fluidcast-harness';
import {
  WorkerSetupError,
  type WorkerHandle,
  type WorkerType,
} from '@yourtechbudstudio/fluidcast-tool-agent';
import type { ClaudeWorkerOptions } from '@yourtechbudstudio/fluidcast-tool-agent/claude';
import type {
  CodexThread,
  CodexWorkerOptions,
} from '@yourtechbudstudio/fluidcast-tool-agent/codex';
import type { WorkerSummary } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { ActiveSession, makeActiveSession } from './active.ts';
import type { BuiltSession, ConversationConfig, SessionSources } from './session.ts';

/** A language model that fails if used. */
export const unusedModel = LanguageModel.make({
  generateText: () => Effect.die('unused'),
  streamText: () => Effect.die('unused') as never,
});

/** A model and a synthesizer that fail if used, as layers. */
export const unusedProviders = Layer.merge(
  Layer.effect(LanguageModel.LanguageModel, unusedModel),
  Layer.succeed(
    SpeechSynthesizer,
    SpeechSynthesizer.of({ synthesize: () => Effect.die('unused') as never }),
  ),
);

/** A worker whose status and transcript emit once and then never end, like a live worker's. */
export const fakeWorkerHandle = (sessionId: string | null = 'worker-session'): WorkerHandle => {
  const idle: WorkerSummary = { _tag: 'WorkerSummary', status: 'idle', sessionId };
  return {
    status: Stream.concat(Stream.make(idle), Stream.never),
    transcript: Stream.concat(
      Stream.make({ _tag: 'TranscriptSnapshot', entries: [] } as const),
      Stream.never,
    ),
  };
};

/** What a fake build did: each start's mode, and each session whose worker close was requested. */
export interface BuildLog {
  readonly started: Array<StartRequest['mode']>;
  readonly closed: Array<number>;
}

/**
 * A fake `build`: a real speech-only Harness session (no tools, providers never called) plus a fake
 * worker (by default one whose streams never end). Like `buildSession`, it acquires the worker first, so its close
 * request (recorded in `log.closed`) runs after the Harness is torn down. `fail` makes it fail after
 * acquiring the worker.
 */
export const fakeBuild = (
  options: { readonly fail?: StartFailed['reason']; readonly worker?: WorkerHandle } = {},
) => {
  const log: BuildLog = { started: [], closed: [] };
  const build = (request: StartRequest): Effect.Effect<BuiltSession, StartFailed, Scope.Scope> =>
    Effect.gen(function* () {
      const index = log.started.push(request.mode) - 1;
      yield* Effect.addFinalizer(() => Effect.sync(() => log.closed.push(index)));
      if (options.fail !== undefined) {
        return yield* Effect.fail(new StartFailed({ reason: options.fail }));
      }
      const context = yield* Layer.build(
        harnessLayer({
          instructions: '',
          speakers: [{ id: 'host', name: 'Host', personality: 'Warm.', voice: { name: 'alloy' } }],
          speechFormat: 'opus',
          tools: [],
        }).pipe(Layer.provide(unusedProviders)),
      );
      return {
        session: Context.get(context, Session),
        worker: options.worker ?? fakeWorkerHandle(),
      };
    });
  return { build, log };
};

/** `ActiveSession` over a fake build, as a layer for the routes. */
export const fakeActiveLayer = (build: ReturnType<typeof fakeBuild>['build']) =>
  Layer.effect(ActiveSession, makeActiveSession(build));

/** Starts a new session and returns its ID, read from the status stream. */
export const startNew = Effect.gen(function* () {
  const active = yield* ActiveSession;
  yield* active.start({ mode: 'new', agent: 'claude' });
  const status = yield* Stream.runHead(active.status);
  if (status._tag === 'None' || status.value._tag !== 'Active') {
    return yield* Effect.die('expected an active session');
  }
  return status.value.id;
});

/** A resolved conversation config whose worker settings point nowhere real. */
export const conversationConfig = (
  overrides: Partial<ConversationConfig> = {},
): ConversationConfig => ({
  llm: { type: 'chatgpt', model: 'm', credentialsPath: '/unused' },
  preset: { voice: { name: 'alloy' } },
  worker: {
    cwd: process.cwd(),
    environment: {},
    claude: {},
    codex: {},
    claudeConfigDir: '/nonexistent-claude-config',
    claudeExecutable: '/nonexistent/claude',
  },
  ...overrides,
});

/** A stored session message with the given content. */
export const storedMessage = (
  type: SessionMessage['type'],
  content: unknown,
  parent: string | null = null,
): SessionMessage => ({
  type,
  uuid: crypto.randomUUID(),
  session_id: 'stored',
  message: { role: type, content },
  parent_tool_use_id: parent,
  parent_agent_id: null,
});

/** A worker type that spawns nothing: `attach` succeeds, or fails with `attachFailure`. */
const fakeWorkerType = (
  cwd: string,
  attachFailure: WorkerSetupError['reason'] | undefined,
): WorkerType => ({
  cwd,
  composeMessage: (prompt) => prompt,
  attach: (sessionId) =>
    attachFailure === undefined
      ? Effect.succeed({ cwd, history: [] })
      : Effect.fail(new WorkerSetupError({ sessionId, reason: attachFailure })),
  connect: () => Stream.die('the fake worker never connects'),
});

/**
 * Fake `SessionSources`: stored Claude messages (or a throw), a stored Codex thread (or a read
 * failure), and worker types for both agents that record the options they were made with, plus
 * each read thread's ID and environment. Every `attach` succeeds, or fails with `attachFailure`.
 */
export const fakeSources = (options: {
  readonly messages?: ReadonlyArray<SessionMessage> | 'throw';
  readonly thread?: CodexThread | 'fail';
  readonly attachFailure?: WorkerSetupError['reason'];
}) => {
  const workers: Array<ClaudeWorkerOptions> = [];
  const codexWorkers: Array<CodexWorkerOptions> = [];
  const threadReads: Array<{ readonly threadId: string; readonly environment: unknown }> = [];
  const sources: SessionSources = {
    claudeWorker: (workerOptions) => {
      workers.push(workerOptions);
      return fakeWorkerType(workerOptions.cwd, options.attachFailure);
    },
    sessionMessages: async () => {
      if (options.messages === 'throw') throw new Error('unreadable');
      return options.messages ?? [];
    },
    codexWorker: (workerOptions) => {
      codexWorkers.push(workerOptions);
      return fakeWorkerType(workerOptions.cwd, options.attachFailure);
    },
    readCodexThread: (threadId, { environment }) => {
      threadReads.push({ threadId, environment });
      const thread = options.thread ?? {
        model: undefined,
        effort: undefined,
        lastAnswer: undefined,
      };
      return thread === 'fail'
        ? Effect.fail(new WorkerSetupError({ sessionId: threadId, reason: 'SessionUnreadable' }))
        : Effect.succeed(thread);
    },
  };
  return { sources, workers, codexWorkers, threadReads };
};

/** The `data:` payloads of an SSE body, in order. */
export const dataOf = (body: string) =>
  body
    .split('\n\n')
    .filter((event) => event.startsWith('data: '))
    .map((event) => event.slice('data: '.length));

/** The first `data:` payload of a streaming SSE response; then cancels the body. */
export const firstData = async (response: Response): Promise<string | undefined> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return dataOf(text)[0];
      text += decoder.decode(value, { stream: true });
      const [first] = dataOf(text);
      if (first !== undefined && text.includes('\n\n')) return first;
    }
  } finally {
    await reader.cancel();
  }
};

/** A request to the app under test: a path, and optionally a method and a JSON body. */
export type Send = (
  path: string,
  init?: { readonly method?: string; readonly json?: unknown },
) => Promise<Response>;

/** A web handler for the app under test (`HttpRouter.toWebHandler`'s result). */
export interface WebApp {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}

/** Serves `app` for the duration of `use`, then disposes it. */
export const withApp = async <A>(
  { handler, dispose }: WebApp,
  use: (send: Send) => Promise<A>,
): Promise<A> => {
  try {
    return await use((path, init = {}) =>
      handler(
        new Request(`http://localhost${path}`, {
          method: init.method ?? 'GET',
          ...(init.json === undefined
            ? {}
            : {
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(init.json),
              }),
        }),
      ),
    );
  } finally {
    await dispose();
  }
};

const decodeStatus = Schema.decodeSync(SessionStatusJson);

/** The current session status, read as the first message of `GET /api/session`. */
export const statusOver = async (send: Send) => {
  const data = await firstData(await send(routes.session));
  if (data === undefined) throw new Error('no session status');
  return decodeStatus(data);
};

/** Starts a new session over `POST /api/session` and returns its ID. */
export const startOver = async (send: Send) => {
  const response = await send(routes.session, {
    method: 'POST',
    json: { mode: 'new', agent: 'claude' },
  });
  if (response.status !== 204) throw new Error(`start failed with ${response.status}`);
  const status = await statusOver(send);
  if (status._tag !== 'Active') throw new Error('expected an active session');
  return status.id;
};
