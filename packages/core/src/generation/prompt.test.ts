import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { Result, Schema } from 'effect';

import type { SpeakerProfile } from '../actions/index.ts';
import { buildSystemPrompt } from './prompt.ts';
import { checkTools, decodeToolCall, type ToolDefinition } from './tools.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** Captured from the speech-only `buildSystemPrompt` before tools existed. */
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
  it('is byte-identical to the speech-only prompt when no tools are registered', () => {
    const names = Object.keys(configs);
    assert.equal(names.length, 3);
    for (const name of names) {
      const config = configs[name];
      assert.ok(config !== undefined);
      assert.equal(buildSystemPrompt({ ...config, tools: [] }), fixture(`${name}.txt`), name);
    }
  });

  it('adds tool rules after the rules and before the instructions, deduplicated in tool order', () => {
    const prompt = buildSystemPrompt({ instructions: 'Teach.', speakers, tools: [note, runQuery] });
    const headings = [...prompt.matchAll(/^(## .*|<instructions>|<speakers>)$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(headings, [
      '## Role',
      '<speakers>',
      '## Rules',
      '## Tool rules',
      '<instructions>',
      '## Output format',
      '## Examples (listener input, then your response)',
    ]);
    const toolRules = prompt.slice(
      prompt.indexOf('## Tool rules'),
      prompt.indexOf('<instructions>'),
    );
    assert.equal(
      toolRules,
      [
        '## Tool rules',
        '- Use `note` for asides.',
        '- Keep each `note` short.',
        '- Use `run_query` for data.',
      ].join('\n') + '\n\n',
    );
    assert.match(prompt, /### Tools and pacing\n- Besides `speak`/);
    assert.match(prompt, /- Speak text is plain spoken language:/);
    assert.match(prompt, /deliver it rather than stalling\./);
    assert.doesNotMatch(prompt, /Don't ask permission/);
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

  it('is identical for identical input', () => {
    const options = { instructions: 'Teach.', speakers, tools: [note, runQuery] };
    assert.equal(buildSystemPrompt(options), buildSystemPrompt(options));
  });

  it('rejects a bad tool list', () => {
    assert.throws(() => buildSystemPrompt({ instructions: '', speakers, tools: [note, note] }));
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
