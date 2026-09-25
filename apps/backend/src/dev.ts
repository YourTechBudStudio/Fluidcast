/**
 * Development entry: serves the API only, because Vite serves the web app and proxies `/api`.
 * Usage: `node src/dev.ts --config <path>` (the `dev` script points at the repo's `fluidcast.yaml`).
 */
import { parseArgs } from 'node:util';

import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { Console, Effect } from 'effect';

import { loadConfig } from './config.ts';
import { serve } from './server.ts';

const { values } = parseArgs({
  options: { config: { type: 'string', default: 'fluidcast.yaml' } },
});

loadConfig(values.config).pipe(
  Effect.flatMap((config) => serve(config)),
  Effect.catchTag('ConfigError', (error) =>
    Effect.andThen(
      Console.error(error.message),
      Effect.sync(() => (process.exitCode = 1)),
    ),
  ),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
