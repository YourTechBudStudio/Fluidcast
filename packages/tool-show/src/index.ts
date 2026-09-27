import { Effect } from 'effect';

import { ToolError, type Tool } from '@yourtechbudstudio/fluidcast-harness';

import { ShowCommand, ShowInput, ShowResult, showToolName } from './schema.ts';

export * from './schema.ts';

/** How much of a client's failure reason the model reads. */
const reasonLimit = 300;

/**
 * The Show tool: puts Markdown, a Mermaid diagram or HTML in front of the listener. A client
 * renders each execution and reports it once. It never blocks the conversation, only a render
 * failure reaches the model (so it can send a corrected Show), and it executes again on forward
 * replay.
 */
export const showTool = (): Tool<ShowInput, ShowResult, ShowCommand> => ({
  name: showToolName,
  input: ShowInput,
  guidelines: [
    'Use `show` to put the material you are presenting in front of the listener, one idea per `show`: lists, tables, a decision with its reasons, options, flows. Speech explains it; the `show` holds it.',
    'A `show` is faithful to what you are presenting: keep its points, meaning and structure, and add nothing it does not contain.',
    'Introduce a `show` without reading its content out, then explain it while it is on screen.',
    'Use `show` with `mermaid` for every diagram, writing only the Mermaid source, never a code fence.',
    'Use `show` with `markdown` for text, lists and tables, and with `html` only for layouts or small interactive demos Markdown cannot express. HTML scripts run.',
    'Each `show` is complete and replaces the previous one. To build on a diagram, send the whole diagram again.',
  ],
  result: ShowResult,
  // Never read: under response `error`, a rendered Show queues nothing.
  renderResult: () => 'Shown.',
  policy: { blocking: false, response: 'error', replay: true },
  command: () => ShowCommand,
  run: (_input, context) =>
    Effect.flatMap(context.awaitCommand, (report) =>
      'rendered' in report
        ? Effect.succeed({})
        : Effect.fail(
            new ToolError({
              message: `The show could not be rendered: ${report.failed.slice(0, reasonLimit)}`,
            }),
          ),
    ),
});
