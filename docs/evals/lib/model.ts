/**
 * Model clients for the eval. Qwen goes straight to the vLLM Chat Completions endpoint (streamed,
 * optional json_schema response_format). SOL goes through the backend's ChatGPT sign-in layer.
 * Both report timings: first content token, first complete top-level array element (first action),
 * and total.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type Generation = {
  text: string;
  reasoningChars: number;
  ttftMs: number | null;
  firstActionMs: number | null;
  totalMs: number;
  usage?: { prompt: number; completion: number; reasoning?: number; cached?: number };
  error?: string;
  /** The stream was cut because it degenerated into whitespace (constrained decoding after a stray quote). */
  runaway?: boolean;
};

export type ModelOptions = {
  model: 'qwen' | 'sol' | 'luna';
  temperature?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  jsonSchema?: unknown;
  maxTokens?: number;
};

const root = new URL('../../../', import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(`${root}.env`, 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]),
);
/** The voice model's Chat Completions endpoint and model name (from the environment or the repo's .env). */
const setting = (name: string) => process.env[name] ?? env[name];
const qwenBase = setting('FLUIDCAST_EVAL_BASE_URL');
const qwenModel = setting('FLUIDCAST_EVAL_MODEL') ?? 'qwen';

/** Tracks top-level JSON array elements as text streams in, to time the first complete action. */
const elementWatcher = () => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let elements = 0;
  return (chunk: string): number => {
    for (const ch of chunk) {
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 1 && ch === '}') elements++;
      }
    }
    return elements;
  };
};

export const generateQwen = async (
  messages: ReadonlyArray<ChatMessage>,
  options: ModelOptions,
): Promise<Generation> => {
  const started = performance.now();
  if (qwenBase === undefined)
    throw new Error("Set FLUIDCAST_EVAL_BASE_URL to the voice model's /v1 endpoint");
  const body = {
    model: qwenModel,
    stream: true,
    stream_options: { include_usage: true },
    messages,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.reasoningEffort === undefined ? {} : { reasoning_effort: options.reasoningEffort }),
    max_tokens: options.maxTokens ?? 3000,
    ...(options.jsonSchema === undefined
      ? {}
      : {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'actions', schema: options.jsonSchema, strict: true },
          },
        }),
  };
  let text = '';
  let reasoningChars = 0;
  let ttftMs: number | null = null;
  let firstActionMs: number | null = null;
  let usage: Generation['usage'];
  const watch = elementWatcher();
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${qwenBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${setting('FLUIDCAST_LLM_API_KEY')}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok || response.body === null) {
        throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          const event = JSON.parse(data);
          if (event.usage) {
            usage = {
              prompt: event.usage.prompt_tokens,
              completion: event.usage.completion_tokens,
              reasoning: event.usage.completion_tokens_details?.reasoning_tokens,
              cached: event.usage.prompt_tokens_details?.cached_tokens,
            };
          }
          const delta = event.choices?.[0]?.delta;
          if (!delta) continue;
          const reasoning = delta.reasoning_content ?? delta.reasoning;
          if (typeof reasoning === 'string') reasoningChars += reasoning.length;
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            ttftMs ??= performance.now() - started;
            text += delta.content;
            if (firstActionMs === null && watch(delta.content) > 0) {
              firstActionMs = performance.now() - started;
            }
            if (/\s{200}$/.test(text)) {
              await response.body.cancel().catch(() => {});
              return {
                text: text.trimEnd(),
                reasoningChars,
                ttftMs,
                firstActionMs,
                totalMs: performance.now() - started,
                usage,
                runaway: true,
              };
            }
          }
        }
      }
      return {
        text,
        reasoningChars,
        ttftMs,
        firstActionMs,
        totalMs: performance.now() - started,
        usage,
      };
    } catch (error) {
      if (attempt >= 4) {
        return {
          text,
          reasoningChars,
          ttftMs,
          firstActionMs,
          totalMs: performance.now() - started,
          error: String(error),
        };
      }
      text = '';
      reasoningChars = 0;
      ttftMs = null;
      firstActionMs = null;
      await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
    }
  }
};

/** SOL or LUNA through the backend's ChatGPT sign-in (Responses API, default service tier). */
export const generateChatGpt = async (
  messages: ReadonlyArray<ChatMessage>,
  options: ModelOptions,
): Promise<Generation> => {
  const [
    { Effect, Layer, Stream },
    { LanguageModel },
    { FetchHttpClient },
    NodeServices,
    creds,
    lm,
  ] = await Promise.all([
    import('effect'),
    import('effect/unstable/ai'),
    import('effect/unstable/http'),
    import('@effect/platform-node/NodeServices'),
    import('../../../apps/backend/src/chatgpt/credentials.ts'),
    import('../../../apps/backend/src/conversation/language-model.ts'),
  ]);
  const layer = lm.languageModelLayer({
    type: 'chatgpt',
    model: options.model === 'luna' ? 'gpt-6-luna' : 'gpt-6.1-sol',
    reasoningEffort:
      options.reasoningEffort === 'none' ? 'low' : (options.reasoningEffort ?? 'low'),
    credentialsPath: creds.credentialsPath(homedir()),
  });
  const started = performance.now();
  let text = '';
  let ttftMs: number | null = null;
  let firstActionMs: number | null = null;
  const watch = elementWatcher();
  const program = LanguageModel.streamText({ prompt: messages as never }).pipe(
    Stream.runForEach((part: { type: string; delta?: string }) =>
      Effect.sync(() => {
        if (part.type === 'text-delta' && part.delta) {
          ttftMs ??= performance.now() - started;
          text += part.delta;
          if (firstActionMs === null && watch(part.delta) > 0)
            firstActionMs = performance.now() - started;
        }
      }),
    ),
  );
  try {
    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          layer.pipe(Layer.provide(Layer.mergeAll(FetchHttpClient.layer, NodeServices.layer))),
        ),
        Effect.provide(NodeServices.layer),
      ) as never,
    );
    return { text, reasoningChars: 0, ttftMs, firstActionMs, totalMs: performance.now() - started };
  } catch (error) {
    return {
      text,
      reasoningChars: 0,
      ttftMs,
      firstActionMs,
      totalMs: performance.now() - started,
      error: String(error),
    };
  }
};

export const generateWith = (messages: ReadonlyArray<ChatMessage>, options: ModelOptions) =>
  options.model === 'qwen' ? generateQwen(messages, options) : generateChatGpt(messages, options);
