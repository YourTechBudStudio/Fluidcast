import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parseEnv } from 'node:util';

import { Effect, FileSystem, Path, Redacted, Schema } from 'effect';
import { Yaml } from 'effect/encoding';

import { defaultCompactionThreshold } from '@yourtechbudstudio/fluidcast-presets';

import { credentialsPath, readCredentials } from './chatgpt/index.ts';
import {
  ConversationSections,
  type ConversationConfig,
  type LlmConfig,
  type LlmSection,
  type ReasoningEffort,
} from './conversation/index.ts';
import { defaultApiKeyEnv, ProvidersSection, ProviderType, type Connection } from './providers.ts';
import { SpeechSections, type SpeechConfig } from './speech/index.ts';

/** The YAML file's shape: the server and provider sections plus each slice's sections. */
export const ConfigFile = Schema.Struct({
  server: Schema.optionalKey(
    Schema.Struct({
      host: Schema.optionalKey(Schema.NonEmptyString),
      port: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
    }),
  ),
  /** Connections, shared by every section that uses the same provider type. Optional: absent means defaults. */
  providers: Schema.optionalKey(ProvidersSection),
  ...ConversationSections,
  ...SpeechSections,
  /** Development aids. Everything here is off unless set. */
  debug: Schema.optionalKey(
    Schema.Struct({
      /**
       * Appends every generation (prompt, raw reply, finish reason, token usage) to this file as JSON
       * lines, relative to the config file. It records conversation text: keep it local.
       */
      generationLog: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
});
export type ConfigFile = typeof ConfigFile.Type;

/** Fully resolved config: defaults applied and secrets read. Nothing downstream reads the environment. */
export interface Config {
  readonly server: { readonly host: string; readonly port: number };
  readonly conversation: ConversationConfig;
  readonly speech: SpeechConfig;
}

/** The config could not be loaded. `message` says what is wrong and never contains a secret. */
export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  path: Schema.String,
  message: Schema.String,
}) {}

/** An immutable view of the environment. */
export type Environment = Readonly<Record<string, string | undefined>>;

export interface LoadConfigOptions {
  /** The real environment. Defaults to `process.env`; it is read, never modified. */
  readonly environment?: Environment;
  /** The user's home directory, which holds the ChatGPT sign-in. Defaults to `os.homedir()`. */
  readonly homeDirectory?: string;
}

/**
 * Reads, validates and resolves the YAML config at `path`. A `.env` file next to it is read once
 * into an immutable snapshot; variables in the real environment win.
 */
export const loadConfig = (
  path: string,
  options: LoadConfigOptions = {},
): Effect.Effect<Config, ConfigError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const file = paths.resolve(path);
    const fail = (message: string) => Effect.fail(new ConfigError({ path: file, message }));

    if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) {
      return yield* fail(`No config file at ${file}. Pass --config <path>.`);
    }
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.catch(() => fail(`Cannot read the config file ${file}.`)));
    const document = yield* Effect.try({
      try: () => Yaml.parse(text),
      catch: (error) =>
        new ConfigError({
          path: file,
          message: `${file} is not valid YAML: ${error instanceof Error ? error.message : 'parse error'}`,
        }),
    });
    const removed = removedSections(document);
    if (removed.length > 0) {
      return yield* fail(
        `${file} uses removed sections: ${removed.join(', ')}. The voice's behavior now comes from the Guided Walkthrough preset: delete them and add \`preset: { profile, voice }\`, moving the speaker's voice to preset.voice. See fluidcast.example.yaml.`,
      );
    }
    if (usesFlatLlm(document)) {
      return yield* fail(
        `${file} puts the model directly under llm. It now goes under llm.voice: indent the existing llm settings one level under \`voice:\`. llm.summary is an optional second model for progress and history summaries. See fluidcast.example.yaml.`,
      );
    }
    const parsed = yield* Schema.decodeUnknownEffect(ConfigFile)(document, {
      errors: 'all',
      onExcessProperty: 'error',
    }).pipe(Effect.catch((error) => fail(`${file} is invalid:\n${error.message}`)));

    const environment = yield* readEnvironment(
      fs,
      paths.join(paths.dirname(file), '.env'),
      options.environment ?? process.env,
    ).pipe(Effect.catch((message) => fail(message)));

    const directory = paths.dirname(file);
    const relativeToConfig = (target: string) => paths.resolve(directory, target);
    const home = options.homeDirectory ?? homedir();
    const real = options.environment ?? process.env;
    const worker = workerConfig(
      parsed,
      real,
      directory,
      home,
      relativeToConfig,
      yield* findExecutable(fs, paths, real['PATH'], 'claude'),
    );
    return yield* resolve(parsed, environment, relativeToConfig, worker, home).pipe(
      Effect.catch((message) => fail(message)),
    );
  });

/** Top-level sections the `preset` section replaced. */
const replacedByPreset = ['instructions', 'examples', 'reminders', 'speakers'];

/** The replaced sections a parsed config document still has, in their usual order. */
const removedSections = (document: unknown): ReadonlyArray<string> =>
  typeof document === 'object' && document !== null
    ? replacedByPreset.filter((key) => Object.hasOwn(document, key))
    : [];

/** Whether the document has the old `llm` shape: a model's settings directly under `llm`. */
const usesFlatLlm = (document: unknown): boolean => {
  if (typeof document !== 'object' || document === null || !Object.hasOwn(document, 'llm')) {
    return false;
  }
  const llm: unknown = (document as { readonly llm: unknown }).llm;
  return (
    typeof llm === 'object' &&
    llm !== null &&
    (Object.hasOwn(llm, 'model') || Object.hasOwn(llm, 'provider'))
  );
};

/** The real environment over the `.env` file's variables, if the file exists. */
const readEnvironment = (fs: FileSystem.FileSystem, envFile: string, real: Environment) =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(envFile).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return Object.freeze({ ...real });
    const text = yield* fs
      .readFileString(envFile)
      .pipe(Effect.mapError(() => `Cannot read ${envFile}.`));
    const fromFile = yield* Effect.try({
      try: () => parseEnv(text),
      // Never echo the file: it holds secrets.
      catch: () => `${envFile} could not be parsed.`,
    });
    return Object.freeze({ ...fromFile, ...definedOnly(real) });
  });

const definedOnly = (environment: Environment): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value;

/** Whether a provider type is reached with an API key (has a `providers` connection). */
const isApiKeyProvider = Schema.is(ProviderType);

/** The environment variable holding a provider type's key. */
const apiKeyEnvFor = (file: ConfigFile, type: ProviderType): string =>
  file.providers?.[type]?.apiKeyEnv ?? defaultApiKeyEnv[type];

/**
 * The first executable regular file named `name` in the `PATH` directories, as an absolute path,
 * like a shell's lookup.
 */
const findExecutable = (
  fs: FileSystem.FileSystem,
  paths: Path.Path,
  searchPath: string | undefined,
  name: string,
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    for (const directory of (searchPath ?? '').split(delimiter)) {
      if (directory === '') continue;
      const candidate = paths.resolve(directory, name);
      const info = yield* fs.stat(candidate).pipe(Effect.option);
      if (info._tag === 'Some' && info.value.type === 'File' && (info.value.mode & 0o111) !== 0) {
        return candidate;
      }
    }
    return undefined;
  });

/**
 * Where a new worker runs (`workers.cwd`, else the config file's directory), the `workers.claude`
 * and `workers.codex` settings, and the environment it gets: the real environment (never `.env` values) minus the
 * variables holding the configured providers' keys. Credential hygiene, not isolation. Claude
 * Code's config directory and executable also come from the real environment, because that is
 * what the in-process SDK readers and the worker process see.
 */
const workerConfig = (
  file: ConfigFile,
  real: Environment,
  directory: string,
  home: string,
  relativeToConfig: (path: string) => string,
  claudeExecutable: string | undefined,
): ConversationConfig['worker'] => {
  const providerKeyNames = new Set(
    [file.llm.voice.provider.type, file.llm.summary?.provider.type, file.tts.provider.type]
      .filter(isApiKeyProvider)
      .map((type) => apiKeyEnvFor(file, type)),
  );
  const { claude, codex } = file.workers ?? {};
  return {
    cwd: file.workers?.cwd === undefined ? directory : relativeToConfig(file.workers.cwd),
    claude: {
      ...(claude?.model === undefined ? {} : { model: claude.model }),
      ...(claude?.effort === undefined ? {} : { effort: claude.effort }),
    },
    codex: {
      ...(codex?.model === undefined ? {} : { model: codex.model }),
      ...(codex?.effort === undefined ? {} : { effort: codex.effort }),
    },
    claudeConfigDir: nonEmpty(real['CLAUDE_CONFIG_DIR']) ?? join(home, '.claude'),
    // Not installed: the bare name fails the SDK's existence check, so the worker faults at startup.
    claudeExecutable: claudeExecutable ?? 'claude',
    environment: Object.freeze(
      Object.fromEntries(
        Object.entries(definedOnly(real)).filter(([name]) => !providerKeyNames.has(name)),
      ),
    ),
  };
};

/** Resolves the connection for a provider type: its base URL, and its key read from the environment. */
const connection = (
  file: ConfigFile,
  environment: Environment,
  type: ProviderType,
): Effect.Effect<Connection, string> => {
  const section = file.providers?.[type];
  const keyEnv = apiKeyEnvFor(file, type);
  const key = nonEmpty(environment[keyEnv]);
  if (key === undefined) {
    return Effect.fail(
      `The ${type} API key is missing: set ${keyEnv} in the environment or in a .env file next to the config (providers.${type}.apiKeyEnv).`,
    );
  }
  return Effect.succeed({
    apiKey: Redacted.make(key),
    ...(section?.baseUrl === undefined ? {} : { baseUrl: section.baseUrl }),
  });
};

/**
 * One LLM section's settings (`path` is `llm.voice` or `llm.summary`, for messages), and how it is
 * reached: an API-key connection, or the ChatGPT sign-in, which must exist (it is not refreshed
 * here).
 */
const llmConfig = (
  file: ConfigFile,
  section: LlmSection,
  path: string,
  environment: Environment,
  homeDirectory: string,
): Effect.Effect<LlmConfig, string, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const { provider } = section;
    const shared = {
      model: section.model,
      ...(section.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: section.maxOutputTokens }),
    };
    if (provider.structuredOutput === true && provider.type !== 'openai-compatible') {
      return yield* Effect.fail(
        `${path}.provider.structuredOutput is supported only by the openai-compatible provider type, not ${provider.type}: it sends Chat Completions' response_format with a JSON Schema whose root is an array. Remove it.`,
      );
    }
    /** The OpenAI types' settings: Anthropic takes no `temperature`, and its own effort levels. */
    const openAi = (reasoningEffort: ReasoningEffort | undefined) => ({
      ...shared,
      ...(section.temperature === undefined ? {} : { temperature: section.temperature }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    });
    switch (provider.type) {
      case 'openai-compatible':
        return {
          ...openAi(provider.reasoningEffort),
          type: provider.type,
          connection: yield* connection(file, environment, provider.type),
          structuredOutput: provider.structuredOutput ?? false,
        };
      case 'openai':
        return {
          ...openAi(provider.reasoningEffort),
          type: provider.type,
          connection: yield* connection(file, environment, provider.type),
        };
      case 'anthropic': {
        if (section.temperature !== undefined) {
          return yield* Effect.fail(
            `${path}.temperature is not supported with the anthropic provider type: current Claude models reject non-default sampling. Remove it, and use ${path}.provider.reasoningEffort to trade quality for speed.`,
          );
        }
        return {
          ...shared,
          type: provider.type,
          connection: yield* connection(file, environment, provider.type),
          ...(provider.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: provider.reasoningEffort }),
          ...(provider.speed === undefined ? {} : { speed: provider.speed }),
        };
      }
      case 'chatgpt': {
        if (section.maxOutputTokens !== undefined) {
          return yield* Effect.fail(
            `${path}.maxOutputTokens is not supported with the chatgpt provider type. Remove it.`,
          );
        }
        const credentials = credentialsPath(homeDirectory);
        yield* readCredentials(credentials).pipe(
          Effect.mapError((error) =>
            error.reason === 'Missing'
              ? `${path}.provider is chatgpt but you are not signed in to ChatGPT (no ${credentials}). Run pnpm chatgpt:login.`
              : `${credentials} is not a valid ChatGPT sign-in. Run pnpm chatgpt:login again.`,
          ),
        );
        return {
          ...openAi(provider.reasoningEffort),
          type: provider.type,
          credentialsPath: credentials,
        };
      }
    }
  });

/**
 * `llm.summary`'s settings. Its replies are plain text, so it takes no `structuredOutput`. It
 * cannot be a second ChatGPT sign-in beside a ChatGPT voice: two sign-ins on one credentials file
 * refresh the same rotating token independently, and can sign the user out.
 */
const summaryConfig = (
  file: ConfigFile,
  section: LlmSection,
  environment: Environment,
  homeDirectory: string,
): Effect.Effect<LlmConfig, string, FileSystem.FileSystem> => {
  if (section.provider.structuredOutput !== undefined) {
    return Effect.fail(
      'llm.summary.provider.structuredOutput is not accepted: the summary model writes plain text (progress sentences and history summaries), not actions. Remove it.',
    );
  }
  if (section.provider.type === 'chatgpt' && file.llm.voice.provider.type === 'chatgpt') {
    return Effect.fail(
      'llm.summary cannot also use the chatgpt provider type: it would open a second sign-in on the same credentials. Omit llm.summary to use the voice model, or use an API-key provider for it.',
    );
  }
  return llmConfig(file, section, 'llm.summary', environment, homeDirectory);
};

/** `FLUIDCAST_PORT` over `server.port`, so a dev runner can allocate the port per checkout. */
const serverPort = (file: ConfigFile, environment: Environment): Effect.Effect<number, string> => {
  const override = nonEmpty(environment['FLUIDCAST_PORT']);
  if (override === undefined) return Effect.succeed(file.server?.port ?? 4700);
  const port = Number(override);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? Effect.succeed(port)
    : Effect.fail(`FLUIDCAST_PORT must be a TCP port from 1 through 65535, not ${override}.`);
};

/** Applies defaults and resolves secrets. Fails with a message naming what is missing. */
const resolve = (
  file: ConfigFile,
  environment: Environment,
  relativeToConfig: (path: string) => string,
  worker: ConversationConfig['worker'],
  homeDirectory: string,
): Effect.Effect<Config, string, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.stat(worker.cwd).pipe(Effect.option);
    if (cwd._tag === 'None' || cwd.value.type !== 'Directory') {
      return yield* Effect.fail(`workers.cwd ${worker.cwd} is not a directory.`);
    }
    const voice = yield* llmConfig(file, file.llm.voice, 'llm.voice', environment, homeDirectory);
    const summary =
      file.llm.summary === undefined
        ? undefined
        : yield* summaryConfig(file, file.llm.summary, environment, homeDirectory);
    const compaction = file.history?.compaction;
    const ttsConnection = yield* connection(file, environment, file.tts.provider.type);
    const port = yield* serverPort(file, environment);

    return {
      server: { host: file.server?.host ?? '127.0.0.1', port },
      conversation: {
        llm: { voice, ...(summary === undefined ? {} : { summary }) },
        ...(compaction?.enabled === true && {
          history: {
            compaction: {
              aboveInputTokens: compaction.aboveInputTokens ?? defaultCompactionThreshold,
            },
          },
        }),
        preset: file.preset,
        worker,
        ...(file.debug?.generationLog === undefined
          ? {}
          : { generationLog: relativeToConfig(file.debug.generationLog) }),
      },
      speech: {
        model: file.tts.model,
        format: file.tts.format ?? 'opus',
        connection: ttsConnection,
      },
    };
  });
