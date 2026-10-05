import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { Result, Schema } from 'effect';

import type { SpeakerProfile } from '../actions/index.ts';
import type { Example } from './examples.ts';
import { buildSystemPrompt, outputJsonSchema } from './prompt.ts';
import { checkTools, decodeToolCall, type ToolDefinition } from './tools.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** Golden speech-only prompts: Core's own text, without tools or examples. */
const configs: Record<
  string,
  { readonly instructions: string; readonly speakers: ReadonlyArray<SpeakerProfile> }
> = JSON.parse(fixture('configs.json'));

const speakers = [{ id: 'host', name: 'Ada', personality: 'Warm and precise.' }];

const tool = (
  overrides: Partial<ToolDefinition> & Pick<ToolDefinition, 'name'>,
): ToolDefinition => ({
  input: Schema.Struct({ value: Schema.String }),
  guidelines: [],
  result: Schema.Struct({}),
  renderResult: () => 'Done.',
  ...overrides,
});

const note = tool({
  name: 'note',
  input: Schema.Struct({
    title: Schema.optionalKey(Schema.String.annotate({ description: 'A heading.' })),
    body: Schema.String,
  }).annotate({ description: 'Pins a note.' }),
  guidelines: ['Use `note` for asides.', 'Keep each `note` short.'],
});

const runQuery = tool({
  name: 'run_query',
  input: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('sql'), text: Schema.String }),
    Schema.Struct({
      kind: Schema.Literal('names'),
      names: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
    }),
  ]),
  guidelines: ['Keep each `note` short.', 'Use `run_query` for data.'],
});

describe('buildSystemPrompt', () => {
  it('matches the golden speech-only prompt when no tools or examples are given', () => {
    const names = Object.keys(configs);
    assert.equal(names.length, 3);
    for (const name of names) {
      const config = configs[name];
      assert.ok(config !== undefined);
      assert.equal(buildSystemPrompt({ ...config, tools: [] }), fixture(`${name}.txt`), name);
    }
  });

  it('puts the instructions first, then speakers, tool rules (deduplicated, in tool order) and the output format', () => {
    const prompt = buildSystemPrompt({
      instructions: '## Role\nTeach.',
      speakers,
      tools: [note, runQuery],
    });
    const headings = [...prompt.matchAll(/^(## .*|<speakers>)$/gm)].map((match) => match[1]);
    assert.deepEqual(headings, ['## Role', '<speakers>', '## Tool rules', '## Output format']);
    assert.ok(prompt.startsWith('## Role\nTeach.\n\n<speakers>'));
    const toolRules = prompt.slice(
      prompt.indexOf('## Tool rules'),
      prompt.indexOf('## Output format'),
    );
    assert.equal(
      toolRules,
      [
        '## Tool rules',
        '- Besides `speak`, you can write the tool actions listed in the output format. Each takes effect when playback reaches it, in the order you wrote it.',
        '- Never write a `call` field. The player adds one to each tool action in your earlier responses. Results refer to it as `<tool_result call="…" tool="…">` or `<tool_error call="…" tool="…">`; one result can answer several calls, as `calls="call_3 call_7"`.',
        '- When a `<tool_error>` arrives, fix what it describes and try again.',
        '- A `<tool_progress>` reports what a running tool is doing. It is not the result.',
        '- A `<context tool="…">` at the end of the input describes a tool\'s current state. It is not the listener speaking.',
        '- Use `note` for asides.',
        '- Keep each `note` short.',
        '- Use `run_query` for data.',
      ].join('\n') + '\n\n',
    );
  });

  it('carries mechanics only, and none without tools', () => {
    const prompt = buildSystemPrompt({ instructions: '', speakers, tools: [note] });
    assert.ok(
      prompt.endsWith('```\nRespond with only a JSON array of `Action`. No prose outside it.'),
    );
    // Role, style, presentation and forwarding are the configuration's (a preset's), not Core's.
    assert.doesNotMatch(prompt, /## Role|## Rules|first person|Voice it|forward|spoken language/);
    const speechOnly = buildSystemPrompt({ instructions: '', speakers, tools: [] });
    assert.doesNotMatch(speechOnly, /`call`|tool_progress|<notice>|<reminder>|## Tool rules/);
  });

  it('renders each tool with an injected `type` and joins them in the `Action` union', () => {
    const prompt = buildSystemPrompt({ instructions: '', speakers, tools: [note, runQuery] });
    const output = prompt.slice(prompt.indexOf('```ts\n') + 6, prompt.indexOf('\n```\n'));
    assert.equal(
      output,
      [
        'type Speak = {',
        '  type: "speak";',
        '  /** Speaker id from <speakers>. */',
        '  speaker: string;',
        '  /** The next stretch of speech, continuing from the previous speak: a few words up to about three sentences. No markdown, lists, or anything unpronounceable. */',
        '  text: string;',
        '};',
        '',
        '/** Pins a note. */',
        'type Note = {',
        '  type: "note";',
        '  /** A heading. */',
        '  title?: string;',
        '  body: string;',
        '};',
        '',
        'type RunQuery = {',
        '  type: "run_query";',
        '  kind: "sql";',
        '  text: string;',
        '} | {',
        '  type: "run_query";',
        '  kind: "names";',
        '  names: string[];',
        '};',
        '',
        'type Action = Speak | Note | RunQuery;',
      ].join('\n'),
    );
  });

  it('keeps the description of a field that has checks, such as a non-empty string', () => {
    const named = tool({
      name: 'named',
      input: Schema.Struct({
        value: Schema.NonEmptyString.annotate({ description: 'Never empty.' }),
      }),
    });
    const prompt = buildSystemPrompt({ instructions: '', speakers, tools: [named] });
    assert.ok(prompt.includes('  /** Never empty. */\n  value: string;'));
  });

  it('renders application examples after the output format, like history (notices included), without `call` and with the lead speaker', () => {
    const pin = tool({
      ...note,
      result: Schema.Struct({ count: Schema.Number }),
      renderResult: ({ count }: { readonly count: number }) => `Pinned <${count}>.`,
      renderCall: (input) => ({ ...input, body: 'B' }),
    });
    const examples = [
      [
        { type: 'user_message', text: 'Pin it.' },
        { type: 'speak', text: 'Pinning.' },
        { type: 'tool_call', tool: 'note', handle: 'call_1', input: { body: 'A' } },
        { type: 'tool_result', tool: 'note', handle: 'call_1', result: { count: 2 } },
        { type: 'speak', text: 'Two now.' },
      ],
      [
        { type: 'user_message', text: 'Hi.' },
        { type: 'speak', text: 'Hello.' },
      ],
      [
        { type: 'speak', text: 'Long story.' },
        { type: 'interrupted', during: 'speech' },
        { type: 'user_message', text: 'Stop.' },
        { type: 'speak', text: 'Okay.' },
      ],
    ] as const;
    const prompt = buildSystemPrompt({ instructions: '', examples, speakers, tools: [pin] });
    const section = prompt.slice(prompt.indexOf('## Examples'));
    assert.ok(prompt.indexOf('## Output format') < prompt.indexOf('## Examples'));
    assert.equal(
      section,
      [
        '## Examples (listener input, then your response)',
        '<user_message>Pin it.</user_message>',
        '[{"type":"speak","speaker":"host","text":"Pinning."},{"type":"note","body":"B"}]',
        '',
        '<tool_result call="call_1" tool="note">Pinned &lt;2&gt;.</tool_result>',
        '[{"type":"speak","speaker":"host","text":"Two now."}]',
        '',
        '<user_message>Hi.</user_message>',
        '[{"type":"speak","speaker":"host","text":"Hello."}]',
        '',
        '',
        '[{"type":"speak","speaker":"host","text":"Long story."}]',
        '',
        '<notice>You were interrupted during your last line.</notice>',
        '<user_message>Stop.</user_message>',
        '[{"type":"speak","speaker":"host","text":"Okay."}]',
      ].join('\n'),
    );
  });

  it('has no examples section without examples', () => {
    for (const examples of [undefined, []]) {
      const prompt = buildSystemPrompt({
        instructions: '',
        ...(examples === undefined ? {} : { examples }),
        speakers,
        tools: [note],
      });
      assert.doesNotMatch(prompt, /## Examples/);
      assert.ok(
        prompt.endsWith('Respond with only a JSON array of `Action`. No prose outside it.'),
      );
    }
  });

  it('rejects an example that uses an unconfigured tool, an invalid call or an invalid result', () => {
    const build = (examples: ReadonlyArray<Example>) => () =>
      buildSystemPrompt({ instructions: '', examples, speakers, tools: [note] });
    assert.throws(
      build([[{ type: 'tool_call', tool: 'show', handle: 'call_1', input: {} }]]),
      /Example 1 uses the tool "show", which is not configured/,
    );
    assert.throws(
      build([[], [{ type: 'tool_call', tool: 'note', handle: 'call_1', input: { body: 1 } }]]),
      /Example 2 has an invalid call: Invalid `note`/,
    );
    const counted = tool({ name: 'note', result: Schema.Struct({ count: Schema.Number }) });
    assert.throws(
      () =>
        checkTools(
          [counted],
          [[{ type: 'tool_result', tool: 'note', handle: 'call_1', result: { count: 'x' } }]],
        ),
      /Example 1 has a `note` result that does not decode/,
    );
  });

  it('is identical for identical input', () => {
    const options = { instructions: 'Teach.', speakers, tools: [note, runQuery] };
    assert.equal(buildSystemPrompt(options), buildSystemPrompt(options));
  });

  it('rejects a bad tool list', () => {
    assert.throws(() => buildSystemPrompt({ instructions: '', speakers, tools: [note, note] }));
  });
});

describe('outputJsonSchema', () => {
  const forward = tool({ name: 'forward', input: Schema.Struct({}) });
  const schema = outputJsonSchema({
    speakers: [...speakers, { id: 'guest' }],
    tools: [note, runQuery, forward],
  });
  const defs = schema['$defs'] as Record<string, Record<string, any>>;
  const items = schema['items'] as { readonly anyOf: ReadonlyArray<Record<string, any>> };
  const runQueryMembers: Array<Record<string, any>> = defs['RunQuery']?.['anyOf'] ?? [];

  it("is an array of the prompt's `Action` union: speak, then each tool by its declared name", () => {
    assert.equal(schema['type'], 'array');
    const [speak, ...tools] = items.anyOf;
    assert.deepEqual(speak?.['properties']?.['type'], { type: 'string', enum: ['speak'] });
    assert.deepEqual(
      tools.map((member) => member['$ref']),
      ['#/$defs/Note', '#/$defs/RunQuery', '#/$defs/Forward'],
    );
    assert.deepEqual(defs['Note']?.['properties']?.['type'], { type: 'string', enum: ['note'] });
    assert.deepEqual(
      runQueryMembers.map((member) => member['properties'].type.enum),
      [['run_query'], ['run_query']],
    );
  });

  it('narrows the speaker to the configured ids', () => {
    const speaker = items.anyOf[0]?.['properties']?.['speaker'];
    assert.equal(speaker.type, 'string');
    assert.deepEqual(speaker.enum, ['host', 'guest']);
    const single = outputJsonSchema({ speakers, tools: [] });
    const [speak] = (single['items'] as { readonly anyOf: Array<any> }).anyOf;
    assert.deepEqual(speak.properties.speaker.enum, ['host']);
    assert.equal(single['$defs'], undefined);
  });

  it('gives a tool without fields only its `type`', () => {
    assert.deepEqual(defs['Forward'], {
      type: 'object',
      properties: { type: { type: 'string', enum: ['forward'] } },
      required: ['type'],
      additionalProperties: false,
    });
  });

  it('rejects excess properties on every action', () => {
    const objects = [items.anyOf[0], defs['Note'], ...runQueryMembers, defs['Forward']];
    for (const object of objects) assert.equal(object?.['additionalProperties'], false);
  });

  it('rejects a bad tool list and needs a speaker', () => {
    assert.throws(() => outputJsonSchema({ speakers, tools: [note, note] }), /registered twice/);
    assert.throws(() => outputJsonSchema({ speakers: [], tools: [] }), /at least one speaker/);
  });
});

describe('checkTools', () => {
  it('accepts structs and unions of structs', () => {
    checkTools([note, runQuery]);
  });

  it('rejects bad names, reserved names and duplicates', () => {
    for (const name of ['Show', 'show-me', '1st', '', 'speak', 'action']) {
      assert.throws(() => checkTools([tool({ name })]), undefined, name);
    }
    assert.throws(() => checkTools([tool({ name: 'note' }), tool({ name: 'note' })]), /twice/);
  });

  it('rejects inputs that are not structs or unions of structs', () => {
    const inputs = [
      Schema.String,
      Schema.Array(Schema.String),
      Schema.Union([Schema.Struct({ a: Schema.String }), Schema.String]),
    ];
    for (const input of inputs) {
      assert.throws(
        () => checkTools([tool({ name: 'bad', input: input as never })]),
        /struct or a union of structs/,
      );
    }
  });

  it('rejects inputs declaring `type` or `call`', () => {
    for (const field of ['type', 'call']) {
      const input = Schema.Struct({ [field]: Schema.String });
      assert.throws(() => checkTools([tool({ name: 'bad', input })]), new RegExp(`"${field}"`));
      const union = Schema.Union([Schema.Struct({ a: Schema.String }), input]);
      assert.throws(() => checkTools([tool({ name: 'bad', input: union })]));
    }
  });
});

describe('decodeToolCall', () => {
  it('decodes a known tool, ignoring excess keys', () => {
    const decoded = decodeToolCall([note], { tool: 'note', input: { body: 'Hi', extra: 1 } });
    assert.ok(Result.isSuccess(decoded));
    assert.equal(decoded.success.tool, note);
    assert.deepEqual(decoded.success.input, { body: 'Hi' });
  });

  it('names the available types for an unknown tool', () => {
    assert.deepEqual(
      decodeToolCall([note, runQuery], { tool: 'nte', input: {} }),
      Result.fail('Unknown action type "nte". Available types: speak, note, run_query.'),
    );
    assert.deepEqual(
      decodeToolCall([], { tool: 'shout', input: {} }),
      Result.fail('Unknown action type "shout". Available types: speak.'),
    );
  });

  it('describes invalid input, capped at 500 characters', () => {
    const invalid = decodeToolCall([note], { tool: 'note', input: { body: 3 } });
    assert.ok(Result.isFailure(invalid));
    assert.match(invalid.failure, /^Invalid `note`: .+/s);

    const long = decodeToolCall([], { tool: 'x'.repeat(600), input: {} });
    assert.ok(Result.isFailure(long));
    assert.equal(long.failure.length, 500);
  });
});
