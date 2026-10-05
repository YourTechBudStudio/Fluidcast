import { Result, Schema } from 'effect';

import type { ToolCall } from '../actions/index.ts';
import type { Example } from './examples.ts';

/**
 * A tool's model-facing input: a struct, or a union of structs, whose encoding is JSON. It never
 * declares `type` or `call`: Core injects `type` into the prompt and strips both when parsing.
 * Nested schemas must not carry an `identifier` annotation, so two tools cannot share a declaration
 * name in the prompt.
 */
export type ToolInput<Input> = Schema.Codec<Input, Schema.Json> &
  (
    | Schema.Struct<Schema.Struct.Fields>
    | Schema.Union<ReadonlyArray<Schema.Struct<Schema.Struct.Fields>>>
  );

/** The half of a tool the model sees. The Harness's `Tool` extends it with execution. */
export interface ToolDefinition<Input = any, Result = any> {
  /** The model-facing action `type`: lowercase `[a-z][a-z0-9_]*`, unique, not `speak` or `action`. */
  readonly name: string;
  readonly input: ToolInput<Input>;
  /**
   * Bullets for the tool-rules section: the tool's mechanics, each naming its tool ("Use `show`
   * to…"). How the voice should use a tool in an experience is the configuration's, not the tool's.
   */
  readonly guidelines: ReadonlyArray<string>;
  readonly result: Schema.Codec<Result, Schema.Json>;
  /** What the model reads inside `<tool_result>`. Must be pure: history renders it again on every iteration. */
  readonly renderResult: (result: Result) => string;
  /**
   * What the model reads back for one of its own earlier calls to this tool: the input as it wrote
   * it (which may not decode), reshaped. Must be pure. Absent: the input as written. The model copies
   * its earlier calls, so this sets the precedent for its next ones.
   */
  readonly renderCall?: (input: ToolCall['input']) => ToolCall['input'];
}

/** A parsed tool call before the Harness assigns its handle. */
export type ToolCallDraft = Omit<ToolCall, 'handle'>;

const namePattern = /^[a-z][a-z0-9_]*$/;
// Their PascalCase would collide with the `Speak` and `Action` declarations in the prompt.
const reservedNames = new Set(['speak', 'action']);
const messageLimit = 500;

/** The input's structs: the input itself, or each member of its union. */
const inputStructs = (tool: ToolDefinition): ReadonlyArray<Schema.Struct<Schema.Struct.Fields>> =>
  'members' in tool.input ? tool.input.members : [tool.input];

/**
 * Checks a tool list, and the application's examples against it, and throws on a configuration
 * defect, like the "at least one speaker" check: a bad or reserved name, a duplicate, an input that
 * is not a struct or a union of structs, an input that declares `type` or `call`, or an example
 * that names a tool not configured, writes a call that does not decode, or holds a result that
 * does not decode with its tool's `result` schema.
 */
export const checkTools = (
  tools: ReadonlyArray<ToolDefinition>,
  examples: ReadonlyArray<Example> = [],
): void => {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (!namePattern.test(tool.name)) {
      throw new Error(`Tool name "${tool.name}" must match ${namePattern.source}`);
    }
    if (reservedNames.has(tool.name)) throw new Error(`Tool name "${tool.name}" is reserved`);
    if (seen.has(tool.name)) throw new Error(`Tool name "${tool.name}" is registered twice`);
    seen.add(tool.name);

    const ast = tool.input.ast;
    const shapeValid =
      ast._tag === 'Objects' ||
      (ast._tag === 'Union' &&
        'members' in tool.input &&
        ast.types.every((member) => member._tag === 'Objects'));
    if (!shapeValid) {
      throw new Error(`Tool "${tool.name}" input must be a struct or a union of structs`);
    }
    for (const struct of inputStructs(tool)) {
      if (struct.ast._tag !== 'Objects' || !('fields' in struct)) {
        throw new Error(`Tool "${tool.name}" input must be a struct or a union of structs`);
      }
      for (const reserved of ['type', 'call']) {
        if (reserved in struct.fields) {
          throw new Error(`Tool "${tool.name}" input must not declare a "${reserved}" field`);
        }
      }
    }
  }
  examples.forEach((example, index) => {
    for (const step of example) {
      if (step.type !== 'tool_call' && step.type !== 'tool_result') continue;
      const tool = tools.find((candidate) => candidate.name === step.tool);
      if (tool === undefined) {
        throw new Error(
          `Example ${index + 1} uses the tool "${step.tool}", which is not configured`,
        );
      }
      if (step.type === 'tool_call') {
        const decoded = decodeToolCall(tools, step);
        if (Result.isFailure(decoded)) {
          throw new Error(`Example ${index + 1} has an invalid call: ${decoded.failure}`);
        }
      } else if (Result.isFailure(Schema.decodeUnknownResult(tool.result)(step.result))) {
        throw new Error(`Example ${index + 1} has a \`${tool.name}\` result that does not decode`);
      }
    }
  });
};

/** Finds the call's tool and decodes its input. The failure is short model-facing text. */
export const decodeToolCall = <T extends ToolDefinition>(
  tools: ReadonlyArray<T>,
  call: Pick<ToolCall, 'tool' | 'input'>,
): Result.Result<{ readonly tool: T; readonly input: unknown }, string> => {
  const tool = tools.find((candidate) => candidate.name === call.tool);
  if (tool === undefined) {
    const available = ['speak', ...tools.map((candidate) => candidate.name)].join(', ');
    return Result.fail(cap(`Unknown action type "${call.tool}". Available types: ${available}.`));
  }
  const decoded = Schema.decodeUnknownResult(tool.input)(call.input);
  return Result.isSuccess(decoded)
    ? Result.succeed({ tool, input: decoded.success })
    : Result.fail(cap(`Invalid \`${tool.name}\`: ${decoded.failure.message}`));
};

const cap = (message: string): string =>
  message.length <= messageLimit ? message : `${message.slice(0, messageLimit - 1)}…`;

/**
 * The tool's flat model-facing schema for the prompt: each input struct with `type` injected first,
 * declared under the tool's PascalCase name with the input's description as its doc comment.
 */
export const modelSchema = (tool: ToolDefinition): Schema.Top => {
  const members = inputStructs(tool).map((struct) =>
    Schema.Struct({ type: Schema.Literal(tool.name), ...struct.fields }),
  );
  const [single] = members;
  const schema = members.length === 1 && single !== undefined ? single : Schema.Union(members);
  const description = tool.input.ast.annotations?.['description'];
  return schema.annotate({
    identifier: pascalCase(tool.name),
    ...(typeof description === 'string' ? { description } : {}),
  });
};

const pascalCase = (name: string): string =>
  name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
