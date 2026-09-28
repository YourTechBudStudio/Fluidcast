import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Redacted } from 'effect';

import { loadConfig, type Environment } from './config.ts';

const directories: Array<string> = [];
after(() => directories.forEach((directory) => rmSync(directory, { recursive: true })));

const validYaml = `
providers:
  openai-compatible: { baseUrl: http://127.0.0.1:9/v1 }
llm: { model: m, provider: { type: openai-compatible, reasoningEffort: low }, temperature: 0.7 }
tts: { model: t, provider: { type: openai } }
speakers:
  - { id: host, name: Host, personality: warm, voice: { name: alloy } }
`;

const keys = {
  FLUIDCAST_OPENAI_API_KEY: 'openai-key',
  FLUIDCAST_OPENAI_COMPATIBLE_API_KEY: 'compatible-key',
};

/** Writes the config (and optionally a `.env`) into a fresh directory and loads it. */
const load = (yaml: string, environment: Environment, envFile?: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'fluidcast-config-'));
  directories.push(directory);
  writeFileSync(join(directory, 'fluidcast.yaml'), yaml);
  if (envFile !== undefined) writeFileSync(join(directory, '.env'), envFile);
  return Effect.runPromise(
    loadConfig(join(directory, 'fluidcast.yaml'), { environment }).pipe(
      Effect.result,
      Effect.provide(NodeServices.layer),
    ),
  );
};

const loaded = async (...args: Parameters<typeof load>) => {
  const result = await load(...args);
  assert.equal(result._tag, 'Success');
  return result.success;
};

const failure = async (...args: Parameters<typeof load>) => {
  const result = await load(...args);
  assert.equal(result._tag, 'Failure');
  return result.failure.message;
};

describe('loadConfig', () => {
  it('reads .env next to the config, with the real environment winning', async () => {
    const config = await loaded(
      validYaml,
      { FLUIDCAST_OPENAI_COMPATIBLE_API_KEY: 'from-environment' },
      'FLUIDCAST_OPENAI_COMPATIBLE_API_KEY=from-file\nFLUIDCAST_OPENAI_API_KEY=openai-from-file\n',
    );
    assert.equal(Redacted.value(config.conversation.llm.connection.apiKey), 'from-environment');
    assert.equal(Redacted.value(config.speech.connection.apiKey), 'openai-from-file');
  });

  it('resolves each section against its provider type, and applies defaults', async () => {
    const config = await loaded(validYaml, keys);
    assert.deepEqual(config.conversation.llm.provider, {
      type: 'openai-compatible',
      reasoningEffort: 'low',
    });
    assert.equal(config.conversation.llm.temperature, 0.7);
    assert.equal(config.conversation.llm.connection.baseUrl, 'http://127.0.0.1:9/v1');
    assert.equal(Redacted.value(config.speech.connection.apiKey), 'openai-key');
    assert.equal(config.speech.connection.baseUrl, undefined);
    assert.equal(config.speech.format, 'opus');
    assert.deepEqual(config.server, { host: '127.0.0.1', port: 4700 });
  });

  it('shares one connection between sections that use the same provider type', async () => {
    const config = await loaded(
      `
providers:
  openai: { baseUrl: http://127.0.0.1:9/v1, apiKeyEnv: SHARED_KEY }
llm: { model: m, provider: { type: openai } }
tts: { model: t, provider: { type: openai } }
speakers:
  - { id: host, name: Host, personality: warm, voice: { name: alloy, instructions: calm } }
`,
      { SHARED_KEY: 'shared' },
    );
    assert.deepEqual(config.conversation.llm.connection, config.speech.connection);
    assert.equal(Redacted.value(config.speech.connection.apiKey), 'shared');
    assert.deepEqual(config.conversation.speakers[0].voice, {
      name: 'alloy',
      instructions: 'calm',
    });
  });

  it('keeps the generation log off by default, and resolves its path next to the config', async () => {
    const off = await loaded(validYaml, keys);
    assert.equal(off.conversation.generationLog, undefined);
    const on = await loaded(
      `${validYaml}debug: { generationLog: ./logs/generations.jsonl }\n`,
      keys,
    );
    assert.match(
      on.conversation.generationLog ?? '',
      /fluidcast-config-[^/]+\/logs\/generations\.jsonl$/,
    );
  });

  it('runs workers next to the config with the real environment minus the provider keys', async () => {
    const config = await loaded(
      validYaml.replace(
        'openai-compatible: { baseUrl',
        'openai-compatible: { apiKeyEnv: MY_COMPATIBLE_KEY, baseUrl',
      ),
      {
        ...keys,
        MY_COMPATIBLE_KEY: 'custom-key',
        PATH: '/usr/bin',
        HOME: '/home/listener',
        UNSET: undefined,
      },
      'FROM_DOTENV=dotenv-only\nFLUIDCAST_OPENAI_API_KEY=openai-from-file\n',
    );
    const { workers } = config.conversation;
    assert.equal(workers.cwd, directories.at(-1));
    assert.deepEqual(workers.environment, {
      // Not a configured provider's key variable here (the llm uses `MY_COMPATIBLE_KEY`), so kept.
      FLUIDCAST_OPENAI_COMPATIBLE_API_KEY: 'compatible-key',
      PATH: '/usr/bin',
      HOME: '/home/listener',
    });
    assert.ok(Object.isFrozen(workers.environment));
  });

  it('omits a default key variable that only the real environment holds', async () => {
    const config = await loaded(validYaml, { ...keys, PATH: '/usr/bin' }, 'OTHER=from-file\n');
    assert.deepEqual(config.conversation.workers.environment, { PATH: '/usr/bin' });
  });

  it('names the missing key variable without leaking other values', async () => {
    const message = await failure(validYaml, {
      FLUIDCAST_OPENAI_COMPATIBLE_API_KEY: 'k',
      OTHER: 'secret-value',
    });
    assert.match(message, /FLUIDCAST_OPENAI_API_KEY/);
    assert.match(message, /providers\.openai\.apiKeyEnv/);
    assert.doesNotMatch(message, /secret-value/);
  });

  it('lists every invalid section', async () => {
    const message = await failure(
      `
llm: { model: m, provider: { type: anthropic } }
tts: { model: t, format: flac, provider: { type: openai-compatible } }
speakers:
  - { id: host, name: Host, personality: warm, voice: alloy }
  - { id: host, name: Again, personality: dry, voice: { name: echo } }
`,
      keys,
    );
    assert.match(message, /is invalid/);
    for (const path of ['llm', 'format', 'tts', 'voice']) assert.match(message, new RegExp(path));
  });

  it('rejects speakers with duplicate ids', async () => {
    const message = await failure(
      `
llm: { model: m, provider: { type: openai } }
tts: { model: t, provider: { type: openai } }
speakers:
  - { id: host, name: Host, personality: warm, voice: { name: alloy } }
  - { id: host, name: Again, personality: dry, voice: { name: echo } }
`,
      keys,
    );
    assert.match(message, /unique ids/);
  });
});
