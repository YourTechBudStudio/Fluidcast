/**
 * The Show tool's contract: everything a client needs to recognise, render and report a Show. A
 * pure export: it imports only `effect`.
 */
import { Schema } from 'effect';

/** The model-facing action `type` of a Show. */
export const showToolName = 'show';

export const ShowFormat = Schema.Literals(['markdown', 'mermaid', 'html']);
export type ShowFormat = typeof ShowFormat.Type;

/** What the model writes: material to put on the side panel, replacing whatever was shown before. */
export const ShowInput = Schema.Struct({
  title: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Heading above the content and on its transcript card.',
    }),
  ),
  format: ShowFormat.annotate({
    description:
      '`markdown` for text and lists, `mermaid` for any diagram, `html` only for layouts Markdown cannot express.',
  }),
  content: Schema.String.annotate({
    description: 'The complete content in that format. It replaces whatever was shown before.',
  }),
});
export type ShowInput = typeof ShowInput.Type;

/** A client's report on one Show execution: it rendered, or it failed with a short reason. */
export const ShowCommand = Schema.Union([
  Schema.Struct({ rendered: Schema.Literal(true) }),
  Schema.Struct({ failed: Schema.String }),
]);
export type ShowCommand = typeof ShowCommand.Type;

/** A rendered Show has nothing to tell the model. */
export const ShowResult = Schema.Struct({});
export type ShowResult = typeof ShowResult.Type;
