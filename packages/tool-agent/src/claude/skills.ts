/**
 * Listing a Claude Code worker's skills through a short-lived query that is sent no message, with
 * the SDK's `query` as a parameter so it can be driven by a fake. Internal: the `./claude` entry
 * builds `listSkills` from it.
 */
import type { Options, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { Effect } from 'effect';

import type { Skill, SkillsUnavailable } from '../schema.ts';
import { boundedListing } from '../worker.ts';
import { queryOptions, type ConnectOptions } from './connect.ts';

/** What listing needs of the SDK's `query`: its commands, and a way to close it. */
export type CommandsQueryFunction = (params: {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options: Options;
}) => {
  readonly supportedCommands: () => Promise<Array<SlashCommand>>;
  readonly close: () => void;
};

/** An input that never yields, so the query starts no turn. */
const noMessages: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
};

const skillOf = (command: SlashCommand): Skill => ({
  name: command.name,
  description: command.description,
  ...(command.argumentHint === '' ? {} : { argumentHint: command.argumentHint }),
});

/** Why listing failed, for the log: only the error's name, never its message. */
const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/**
 * The skills and commands a worker in `cwd` has, Claude Code's own built-ins left out, from a query
 * with the worker's options that is always closed afterwards, on a timeout too.
 */
export const listSkillsWith =
  (query: CommandsQueryFunction, options: ConnectOptions) =>
  (cwd: string): Effect.Effect<ReadonlyArray<Skill>, SkillsUnavailable> =>
    boundedListing(
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* Effect.acquireRelease(
            Effect.try({
              try: () =>
                query({
                  prompt: noMessages,
                  options: queryOptions(options, { cwd, resume: undefined }),
                }),
              catch: (error) => error,
            }),
            (running) => Effect.sync(() => running.close()),
          );
          const commands = yield* Effect.tryPromise({
            try: () => opened.supportedCommands(),
            catch: (error) => error,
          });
          return commands.flatMap((command) =>
            command.builtin === true ? [] : [skillOf(command)],
          );
        }),
      ),
      (error) =>
        Effect.logWarning('claude: skills unavailable').pipe(
          Effect.annotateLogs({ error: errorName(error) }),
        ),
    );
