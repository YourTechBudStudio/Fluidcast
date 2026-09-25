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
llm: { provider: openai, api: chat-completions, baseUrl: http://127.0.0.1:9/v1, model: m }
tts: { provider: openai, model: t }
speakers:
  - { id: host, name: Host, personality: warm, voice: alloy }
`;

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
      { FLUIDCAST_LLM_API_KEY: 'from-environment' },
      'FLUIDCAST_LLM_API_KEY=from-file\nFLUIDCAST_TTS_API_KEY=tts-from-file\n',
    );
    assert.equal(Redacted.value(config.conversation.llm.apiKey), 'from-environment');
    assert.equal(Redacted.value(config.speech.apiKey), 'tts-from-file');
  });

  it('falls back to the LLM key and base URL for TTS, and applies defaults', async () => {
    const config = await loaded(validYaml, { FLUIDCAST_LLM_API_KEY: 'llm-key' });
    assert.equal(Redacted.value(config.speech.apiKey), 'llm-key');
    assert.equal(config.speech.baseUrl, 'http://127.0.0.1:9/v1');
    assert.equal(config.speech.format, 'opus');
    assert.deepEqual(config.server, { host: '127.0.0.1', port: 4700 });
  });

  it('names the missing key variable without leaking other values', async () => {
    const message = await failure(validYaml, { OTHER: 'secret-value' });
    assert.match(message, /FLUIDCAST_LLM_API_KEY/);
    assert.doesNotMatch(message, /secret-value/);
  });

  it('lists every invalid section', async () => {
    const message = await failure(
      `
llm: { provider: anthropic, api: chat-completions, model: m }
tts: { provider: openai, model: t, format: flac }
speakers: []
`,
      { FLUIDCAST_LLM_API_KEY: 'llm-key' },
    );
    assert.match(message, /is invalid/);
    for (const path of ['llm', 'format', 'speakers']) assert.match(message, new RegExp(path));
  });
});
