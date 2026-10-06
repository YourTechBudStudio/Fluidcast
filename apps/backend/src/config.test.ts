import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect, Redacted } from 'effect';

import { loadConfig, type Config, type Environment } from './config.ts';

const directories: Array<string> = [];
after(() => directories.forEach((directory) => rmSync(directory, { recursive: true })));

const validYaml = `
providers:
  openai-compatible: { baseUrl: http://127.0.0.1:9/v1 }
llm: { model: m, provider: { type: openai-compatible, reasoningEffort: low }, temperature: 0.7 }
tts: { model: t, provider: { type: openai } }
preset: { voice: { name: alloy } }
`;

const keys = {
  FLUIDCAST_OPENAI_API_KEY: 'openai-key',
  FLUIDCAST_OPENAI_COMPATIBLE_API_KEY: 'compatible-key',
};

/**
 * Writes the config (and optionally a `.env`) into a fresh directory and loads it, with
 * `homeDirectory` as the user's home when given.
 */
const load = (yaml: string, environment: Environment, envFile?: string, homeDirectory?: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'fluidcast-config-'));
  directories.push(directory);
  writeFileSync(join(directory, 'fluidcast.yaml'), yaml);
  if (envFile !== undefined) writeFileSync(join(directory, '.env'), envFile);
  return Effect.runPromise(
    loadConfig(join(directory, 'fluidcast.yaml'), {
      environment,
      ...(homeDirectory === undefined ? {} : { homeDirectory }),
    }).pipe(Effect.result, Effect.provide(NodeServices.layer)),
  );
};

/** The LLM's API-key connection; fails the test for the ChatGPT sign-in. */
const llmConnection = (config: Config) => {
  const { llm } = config.conversation;
  if (llm.type === 'chatgpt') return assert.fail('expected an API-key LLM provider');
  return llm.connection;
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
    assert.equal(Redacted.value(llmConnection(config).apiKey), 'from-environment');
    assert.equal(Redacted.value(config.speech.connection.apiKey), 'openai-from-file');
  });

  it('resolves each section against its provider type, and applies defaults', async () => {
    const config = await loaded(validYaml, keys);
    assert.equal(config.conversation.llm.type, 'openai-compatible');
    assert.equal(config.conversation.llm.reasoningEffort, 'low');
    assert.equal(config.conversation.llm.temperature, 0.7);
    assert.equal(llmConnection(config).baseUrl, 'http://127.0.0.1:9/v1');
    assert.equal(Redacted.value(config.speech.connection.apiKey), 'openai-key');
    assert.equal(config.speech.connection.baseUrl, undefined);
    assert.equal(config.speech.format, 'opus');
    assert.deepEqual(config.server, { host: '127.0.0.1', port: 4700 });
  });

  it('turns structured output on only when an openai-compatible provider asks for it', async () => {
    const structuredOutput = (config: Config) => {
      const { llm } = config.conversation;
      return llm.type === 'openai-compatible' ? llm.structuredOutput : assert.fail(llm.type);
    };
    assert.equal(structuredOutput(await loaded(validYaml, keys)), false);
    const on = validYaml.replace(
      'reasoningEffort: low',
      'reasoningEffort: low, structuredOutput: true',
    );
    assert.equal(structuredOutput(await loaded(on, keys)), true);
  });

  it('rejects structured output on a provider type other than openai-compatible', async () => {
    const message = await failure(
      `
llm: { model: m, provider: { type: openai, structuredOutput: true } }
tts: { model: t, provider: { type: openai } }
preset: { voice: { name: alloy } }
`,
      keys,
    );
    assert.match(
      message,
      /llm\.provider\.structuredOutput is supported only by the openai-compatible provider type, not openai/,
    );
  });

  it('shares one connection between sections that use the same provider type', async () => {
    const config = await loaded(
      `
providers:
  openai: { baseUrl: http://127.0.0.1:9/v1, apiKeyEnv: SHARED_KEY }
llm: { model: m, provider: { type: openai } }
tts: { model: t, provider: { type: openai } }
preset: { voice: { name: alloy, instructions: calm } }
`,
      { SHARED_KEY: 'shared' },
    );
    assert.deepEqual(llmConnection(config), config.speech.connection);
    assert.equal(Redacted.value(config.speech.connection.apiKey), 'shared');
    assert.deepEqual(config.conversation.preset.voice, {
      name: 'alloy',
      instructions: 'calm',
    });
  });

  it('reads the preset section: a profile (default detailed) and the voice', async () => {
    const config = await loaded(validYaml, keys);
    assert.deepEqual(config.conversation.preset, { voice: { name: 'alloy' } });
    const compact = await loaded(
      validYaml.replace('preset: { voice:', 'preset: { profile: compact, voice:'),
      keys,
    );
    assert.equal(compact.conversation.preset.profile, 'compact');
    assert.match(
      await failure(validYaml.replace('preset: { voice:', 'preset: { profile: tiny, voice:'), keys),
      /profile/,
    );
  });

  it('rejects each section the preset replaced, naming it and pointing to preset', async () => {
    const sections = {
      instructions: 'instructions: Be brief.',
      examples: 'examples: []',
      reminders: 'reminders: { userMessage: x }',
      speakers: 'speakers: [{ id: host, name: Host, voice: { name: alloy } }]',
    };
    for (const [name, yaml] of Object.entries(sections)) {
      const message = await failure(`${validYaml}${yaml}\n`, keys);
      assert.match(message, new RegExp(`uses removed sections: ${name}\\.`));
      assert.match(message, /preset: \{ profile, voice \}/);
    }
    assert.match(
      await failure(`${validYaml}${sections.speakers}\n${sections.instructions}\n`, keys),
      /removed sections: instructions, speakers\./,
    );
  });

  it('loads fluidcast.example.yaml', async () => {
    const example = readFileSync(
      new URL('../../../fluidcast.example.yaml', import.meta.url),
      'utf8',
    );
    const config = await loaded(example, keys);
    assert.equal(config.conversation.preset.profile, 'detailed');
  });

  it('passes an optional reply limit, except with the ChatGPT sign-in', async () => {
    assert.equal((await loaded(validYaml, keys)).conversation.llm.maxOutputTokens, undefined);
    const limited = validYaml.replace(
      'temperature: 0.7',
      'temperature: 0.7, maxOutputTokens: 4096',
    );
    assert.equal((await loaded(limited, keys)).conversation.llm.maxOutputTokens, 4096);
    const zero = validYaml.replace('temperature: 0.7', 'temperature: 0.7, maxOutputTokens: 0');
    assert.match(await failure(zero, keys), /maxOutputTokens/);
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

  it('runs the worker next to the config with the real environment minus the provider keys', async () => {
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
    const { worker } = config.conversation;
    assert.equal(worker.cwd, directories.at(-1));
    assert.deepEqual(worker.environment, {
      // Not a configured provider's key variable here (the llm uses `MY_COMPATIBLE_KEY`), so kept.
      FLUIDCAST_OPENAI_COMPATIBLE_API_KEY: 'compatible-key',
      PATH: '/usr/bin',
      HOME: '/home/listener',
    });
    assert.ok(Object.isFrozen(worker.environment));
  });

  it('omits a default key variable that only the real environment holds', async () => {
    const config = await loaded(validYaml, { ...keys, PATH: '/usr/bin' }, 'OTHER=from-file\n');
    assert.deepEqual(config.conversation.worker.environment, { PATH: '/usr/bin' });
  });

  it('reads the workers section: the Claude model and effort for new sessions', async () => {
    const config = await loaded(
      `${validYaml}workers: { claude: { model: opus, effort: xhigh } }\n`,
      keys,
    );
    assert.deepEqual(config.conversation.worker.claude, { model: 'opus', effort: 'xhigh' });
    assert.deepEqual((await loaded(validYaml, keys)).conversation.worker.claude, {});
  });

  it('resolves workers.cwd relative to the config, and defaults to its directory', async () => {
    assert.equal((await loaded(validYaml, keys)).conversation.worker.cwd, directories.at(-1));
    const config = await loaded(`${validYaml}workers: { cwd: .. }\n`, keys);
    assert.equal(config.conversation.worker.cwd, join(directories.at(-1)!, '..'));
  });

  it('rejects a workers.cwd that is not a directory', async () => {
    assert.match(
      await failure(`${validYaml}workers: { cwd: ./missing }\n`, keys),
      /workers\.cwd .*missing is not a directory\./,
    );
    assert.match(
      await failure(`${validYaml}workers: { cwd: ./fluidcast.yaml }\n`, keys),
      /is not a directory/,
    );
  });

  it('rejects an effort Claude Code does not have', async () => {
    assert.match(
      await failure(`${validYaml}workers: { claude: { effort: turbo } }\n`, keys),
      /is invalid/,
    );
  });

  it("finds Claude Code's sessions in CLAUDE_CONFIG_DIR, else in ~/.claude", async () => {
    const custom = await loaded(validYaml, { ...keys, CLAUDE_CONFIG_DIR: '/claude-config' });
    assert.equal(custom.conversation.worker.claudeConfigDir, '/claude-config');
    const fallback = await loaded(
      validYaml,
      { ...keys, CLAUDE_CONFIG_DIR: '' },
      undefined,
      '/home/me',
    );
    assert.equal(fallback.conversation.worker.claudeConfigDir, '/home/me/.claude');
  });

  it("loads fluidcast.example.yaml's workers block once uncommented", async () => {
    const example = readFileSync(
      new URL('../../../fluidcast.example.yaml', import.meta.url),
      'utf8',
    );
    const block = /^# workers:\n(?:#.*\n)*/m.exec(example)?.[0];
    assert.ok(block !== undefined);
    const uncommented = block
      .split('\n')
      .map((line) => line.replace(/^# ?/, ''))
      .join('\n');
    const config = await loaded(`${validYaml}${uncommented}`, keys);
    assert.deepEqual(config.conversation.worker.claude, { model: 'opus', effort: 'high' });
    assert.equal(config.conversation.worker.cwd, directories.at(-1));
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
preset: { voice: alloy }
`,
      keys,
    );
    assert.match(message, /is invalid/);
    for (const path of ['llm', 'format', 'tts', 'voice']) assert.match(message, new RegExp(path));
  });
});

describe('loadConfig with the ChatGPT sign-in', () => {
  const chatGptYaml = `
llm: { model: m, provider: { type: chatgpt, reasoningEffort: low } }
tts: { model: t, provider: { type: openai } }
preset: { voice: { name: alloy } }
`;

  /** A fresh home directory, with `credentials` as its ChatGPT sign-in when given. */
  const home = (credentials?: string) => {
    const directory = mkdtempSync(join(tmpdir(), 'fluidcast-home-'));
    directories.push(directory);
    if (credentials !== undefined) {
      mkdirSync(join(directory, '.fluidcast'));
      writeFileSync(join(directory, '.fluidcast', 'chatgpt-auth.json'), credentials);
    }
    return directory;
  };

  const signedIn = () =>
    home(
      JSON.stringify({
        hostId: 'host',
        clientId: 'issued',
        accessToken: 'secret-access-token',
        refreshToken: 'secret-refresh-token',
        // Expired: loading checks the sign-in exists, not that its token is fresh.
        expiresAt: 0,
      }),
    );

  it('resolves to the credential file and needs no LLM API key', async () => {
    const directory = signedIn();
    const config = await loaded(
      chatGptYaml,
      { FLUIDCAST_OPENAI_API_KEY: 'openai-key' },
      undefined,
      directory,
    );
    const { llm } = config.conversation;
    assert.deepEqual(llm, {
      model: 'm',
      reasoningEffort: 'low',
      type: 'chatgpt',
      credentialsPath: join(directory, '.fluidcast', 'chatgpt-auth.json'),
    });
  });

  it('tells the user to sign in when there is no credential file', async () => {
    const message = await failure(
      chatGptYaml,
      { FLUIDCAST_OPENAI_API_KEY: 'openai-key' },
      undefined,
      home(),
    );
    assert.match(message, /not signed in to ChatGPT/);
    assert.match(message, /pnpm chatgpt:login/);
  });

  it('rejects an invalid credential file without echoing it', async () => {
    const message = await failure(
      chatGptYaml,
      { FLUIDCAST_OPENAI_API_KEY: 'openai-key' },
      undefined,
      home('{"accessToken":"secret-access-token"}'),
    );
    assert.match(message, /is not a valid ChatGPT sign-in/);
    assert.match(message, /pnpm chatgpt:login/);
    assert.doesNotMatch(message, /secret-access-token/);
  });

  it('rejects structured output', async () => {
    const message = await failure(
      chatGptYaml.replace('reasoningEffort: low', 'reasoningEffort: low, structuredOutput: true'),
      { FLUIDCAST_OPENAI_API_KEY: 'openai-key' },
      undefined,
      signedIn(),
    );
    assert.match(
      message,
      /structuredOutput is supported only by the openai-compatible provider type, not chatgpt/,
    );
  });

  it('rejects a reply limit', async () => {
    const message = await failure(
      chatGptYaml.replace('} }\ntts', '} , maxOutputTokens: 100 }\ntts'),
      { FLUIDCAST_OPENAI_API_KEY: 'openai-key' },
      undefined,
      signedIn(),
    );
    assert.match(message, /llm\.maxOutputTokens is not supported with the chatgpt provider type/);
  });

  it('rejects a providers.chatgpt connection', async () => {
    const message = await failure(
      `providers:\n  chatgpt: { baseUrl: http://127.0.0.1:9/v1 }\n${chatGptYaml}`,
      { FLUIDCAST_OPENAI_API_KEY: 'openai-key' },
      undefined,
      signedIn(),
    );
    assert.match(message, /excess property/);
    assert.match(message, /\["providers"\]\["chatgpt"\]/);
  });

  it("strips only the API-key providers' variables from the worker's environment", async () => {
    const config = await loaded(chatGptYaml, { ...keys, PATH: '/usr/bin' }, undefined, signedIn());
    assert.deepEqual(config.conversation.worker.environment, {
      // Not configured here: the LLM is the ChatGPT sign-in, which has no key variable.
      FLUIDCAST_OPENAI_COMPATIBLE_API_KEY: 'compatible-key',
      PATH: '/usr/bin',
    });
  });
});
