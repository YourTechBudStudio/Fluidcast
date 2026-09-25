import { parseEnv } from 'node:util';

import { Effect, FileSystem, Path, Redacted, Schema } from 'effect';
import { Yaml } from 'effect/unstable/encoding';

import {
  ConversationSections,
  defaultLlmApiKeyEnv,
  type ConversationConfig,
} from './conversation/index.ts';
import { defaultTtsApiKeyEnv, SpeechSections, type SpeechConfig } from './speech/index.ts';

/** The YAML file's shape: the server section plus each slice's sections. */
export const ConfigFile = Schema.Struct({
  server: Schema.optionalKey(
    Schema.Struct({
      host: Schema.optionalKey(Schema.NonEmptyString),
      port: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
    }),
  ),
  ...ConversationSections,
  ...SpeechSections,
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

    return yield* resolve(parsed, environment).pipe(Effect.catch((message) => fail(message)));
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

/** Applies defaults and resolves secrets. Fails with a message naming what is missing. */
const resolve = (file: ConfigFile, environment: Environment): Effect.Effect<Config, string> =>
  Effect.gen(function* () {
    const llmKeyEnv = file.llm.apiKeyEnv ?? defaultLlmApiKeyEnv;
    const llmKey = nonEmpty(environment[llmKeyEnv]);
    if (llmKey === undefined) {
      return yield* Effect.fail(
        `The LLM API key is missing: set ${llmKeyEnv} in the environment or in a .env file next to the config (llm.apiKeyEnv).`,
      );
    }
    // The single agreed fallback: an unset TTS key means the LLM key.
    const ttsKey = nonEmpty(environment[file.tts.apiKeyEnv ?? defaultTtsApiKeyEnv]) ?? llmKey;
    const llmBaseUrl = file.llm.baseUrl;
    const ttsBaseUrl = file.tts.baseUrl ?? llmBaseUrl;

    return {
      server: { host: file.server?.host ?? '127.0.0.1', port: file.server?.port ?? 4700 },
      conversation: {
        llm: {
          api: file.llm.api,
          model: file.llm.model,
          apiKey: Redacted.make(llmKey),
          ...(llmBaseUrl === undefined ? {} : { baseUrl: llmBaseUrl }),
        },
        instructions: file.instructions ?? '',
        speakers: file.speakers,
      },
      speech: {
        model: file.tts.model,
        format: file.tts.format ?? 'opus',
        apiKey: Redacted.make(ttsKey),
        ...(ttsBaseUrl === undefined ? {} : { baseUrl: ttsBaseUrl }),
      },
    };
  });
