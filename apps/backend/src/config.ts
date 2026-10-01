import { homedir } from 'node:os';
import { parseEnv } from 'node:util';

import { Effect, FileSystem, Path, Redacted, Schema } from 'effect';
import { Yaml } from 'effect/unstable/encoding';

import { credentialsPath, readCredentials } from './chatgpt/index.ts';
import {
  ConversationSections,
  type ConversationConfig,
  type LlmConfig,
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
    const workers = workersConfig(parsed, options.environment ?? process.env, directory);
    const home = options.homeDirectory ?? homedir();
    return yield* resolve(parsed, environment, relativeToConfig, workers, home).pipe(
      Effect.catch((message) => fail(message)),
    );
  });

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
 * Where workers run and the environment they get: the real environment (never `.env` values) minus
 * the variables holding the configured providers' keys. Credential hygiene, not isolation.
 */
const workersConfig = (
  file: ConfigFile,
  real: Environment,
  directory: string,
): ConversationConfig['workers'] => {
  const providerKeyNames = new Set(
    [file.llm.provider.type, file.tts.provider.type]
      .filter(isApiKeyProvider)
      .map((type) => apiKeyEnvFor(file, type)),
  );
  return {
    cwd: directory,
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
 * The LLM's settings, and how it is reached: an API-key connection, or the ChatGPT sign-in, which
 * must exist (it is not refreshed here).
 */
const llmConfig = (
  file: ConfigFile,
  environment: Environment,
  homeDirectory: string,
): Effect.Effect<LlmConfig, string, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const { provider } = file.llm;
    const settings = {
      model: file.llm.model,
      ...(file.llm.temperature === undefined ? {} : { temperature: file.llm.temperature }),
      ...(provider.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: provider.reasoningEffort }),
    };
    if (provider.type !== 'chatgpt') {
      return {
        ...settings,
        type: provider.type,
        connection: yield* connection(file, environment, provider.type),
      };
    }
    const path = credentialsPath(homeDirectory);
    yield* readCredentials(path).pipe(
      Effect.mapError((error) =>
        error.reason === 'Missing'
          ? `llm.provider is chatgpt but you are not signed in to ChatGPT (no ${path}). Run pnpm chatgpt:login.`
          : `${path} is not a valid ChatGPT sign-in. Run pnpm chatgpt:login again.`,
      ),
    );
    return { ...settings, type: 'chatgpt' as const, credentialsPath: path };
  });

/** Applies defaults and resolves secrets. Fails with a message naming what is missing. */
const resolve = (
  file: ConfigFile,
  environment: Environment,
  relativeToConfig: (path: string) => string,
  workers: ConversationConfig['workers'],
  homeDirectory: string,
): Effect.Effect<Config, string, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const llm = yield* llmConfig(file, environment, homeDirectory);
    const ttsConnection = yield* connection(file, environment, file.tts.provider.type);

    return {
      server: { host: file.server?.host ?? '127.0.0.1', port: file.server?.port ?? 4700 },
      conversation: {
        llm,
        instructions: file.instructions ?? '',
        speakers: file.speakers,
        workers,
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
