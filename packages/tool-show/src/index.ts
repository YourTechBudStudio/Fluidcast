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
    'Use `show` to put material on screen: `markdown` for text, lists and tables; `mermaid` for diagrams (only the Mermaid source, no code fence). Each `show` replaces the previous one.',
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
