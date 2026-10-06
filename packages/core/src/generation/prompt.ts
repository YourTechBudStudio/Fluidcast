import { type JsonSchema, Schema } from 'effect';

import { ModelSpeak, type SpeakerProfile } from '../actions/index.ts';
import type { Example } from './examples.ts';
import { renderExample } from './history.ts';
import { renderTypeScript } from './render-type.ts';
import { checkTools, modelSchema, type ToolDefinition } from './tools.ts';

/**
 * Builds the system prompt. It is a pure function of the configuration, so providers can cache the
 * prefix. Core supplies mechanics only: the speakers, how tool actions work, the tools' guidelines
 * and the output format. Everything the voice does comes from the configuration's instructions, examples
 * and reminders, normally a preset: without them the prompt has no behavior of its own. The
 * instructions come first, as written; examples come last and use the lead speaker's real ID, so
 * the model never copies a placeholder.
 */
export const buildSystemPrompt = (options: {
  readonly instructions: string;
  readonly examples?: ReadonlyArray<Example>;
  readonly speakers: ReadonlyArray<SpeakerProfile>;
  readonly tools: ReadonlyArray<ToolDefinition>;
}): string => {
  const [lead] = options.speakers;
  if (lead === undefined) throw new Error('buildSystemPrompt requires at least one speaker');
  const examples = options.examples ?? [];
  checkTools(options.tools, examples);
  const instructions = options.instructions.trim();
  const hasTools = options.tools.length > 0;
  const outputType = renderTypeScript(
    actionSchema(ModelSpeak, options.tools).annotate({ identifier: 'Action' }),
  );

  const sections = [
    ...(instructions === '' ? [] : [instructions]),
    [
      '<speakers>',
      ...options.speakers.map(
        (speaker, index) =>
          `- ${speaker.id}${index === 0 ? ' (lead)' : ''}: ${speaker.name}. ${speaker.personality}`,
      ),
      '</speakers>',
    ].join('\n'),
    ...(hasTools
      ? [['## Tool rules', ...toolMechanics, ...toolRules(options.tools)].join('\n')]
      : []),
    [
      '## Output format',
      '```ts',
      outputType,
      '```',
      'Respond with only a JSON array of `Action`. No prose outside it.',
    ].join('\n'),
    ...(examples.length === 0
      ? []
      : [
          `## Examples (listener input, then your response)\n${examples
            .map((example) => renderExample(example, options.tools, lead.id))
            .join('\n\n')}`,
        ]),
  ];
  return sections.join('\n\n');
};

/**
 * One element of the output: a `speak` or one of the tools' actions. The prompt renders it with
 * `ModelSpeak` as the `Action` type; `outputJsonSchema` narrows the speaker to the configured ids.
 */
const actionSchema = (speak: Schema.Top, tools: ReadonlyArray<ToolDefinition>) =>
  Schema.Union([speak, ...tools.map(modelSchema)]);

/**
 * The JSON Schema of the output the system prompt asks for: an array of the same `Action` union it
 * renders, with `speaker` narrowed to the configured ids and excess properties rejected. For
 * providers that constrain decoding to a schema (structured output). Pure, like the prompt; the
 * definitions sit under `$defs`, where its refs point, so the schema is self-contained.
 */
export const outputJsonSchema = (options: {
  readonly speakers: ReadonlyArray<Pick<SpeakerProfile, 'id'>>;
  readonly tools: ReadonlyArray<ToolDefinition>;
}): JsonSchema.JsonSchema => {
  const ids = options.speakers.map((speaker) => speaker.id);
  const [lead, ...rest] = ids;
  if (lead === undefined) throw new Error('outputJsonSchema requires at least one speaker');
  checkTools(options.tools);
  const speaker = rest.length === 0 ? Schema.Literal(lead) : Schema.Literals([lead, ...rest]);
  const speak = Schema.Struct({
    ...ModelSpeak.fields,
    speaker: speaker.annotate(ModelSpeak.fields.speaker.ast.annotations ?? {}),
  });
  const document = Schema.toJsonSchemaDocument(Schema.Array(actionSchema(speak, options.tools)), {
    onExcessProperty: 'error',
  });
  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions };
};

/**
 * How tool actions and their envelopes work, leading the tool rules. Mechanics only, named by their
 * tags, never by a tool: what to do about them is the configuration's.
 */
const toolMechanics: ReadonlyArray<string> = [
  '- Besides `speak`, you can write the tool actions listed in the output format. Each takes effect when playback reaches it, in the order you wrote it.',
  '- Never write a `call` field. The player adds one to each tool action in your earlier responses. Results refer to it as `<tool_result call="…" tool="…">` or `<tool_error call="…" tool="…">`; one result can answer several calls, as `calls="call_3 call_7"`.',
  '- When a `<tool_error>` arrives, fix what it describes and try again.',
  '- A `<tool_progress>` reports what a running tool is doing. It is not the result.',
  '- A `<context tool="…">` at the end of the input describes a tool\'s current state. It is not the listener speaking.',
];

/** Each tool's guidelines as bullets, in tool order, with exact duplicates removed. */
const toolRules = (tools: ReadonlyArray<ToolDefinition>): Array<string> =>
  [...new Set(tools.flatMap((tool) => tool.guidelines))].map((guideline) => `- ${guideline}`);
