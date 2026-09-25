/**
 * `fluidcast serve --config <path> [--port <n>] [--web-root <dir>]`: serves the reference backend
 * and, when web assets are available, the web player, from one process.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { Console, Effect, Option } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';

import { loadConfig, serve } from '@fluidcast/backend';

/** Where the bundle keeps the web assets: `web/` next to `fluidcast.mjs`. */
const bundledWebRoot = fileURLToPath(new URL('./web/', import.meta.url));

const serveCommand = Command.make(
  'serve',
  {
    config: Flag.String('config').pipe(
      Flag.withDefault('fluidcast.yaml'),
      Flag.withDescription('The YAML config. A .env file next to it is read too.'),
    ),
    port: Flag.Int('port').pipe(
      // The same range the config file's server.port accepts.
      Flag.filter(
        (port) => port >= 1 && port <= 65535,
        () => 'a port between 1 and 65535',
      ),
      Flag.optional,
      Flag.withDescription('Overrides server.port from the config.'),
    ),
    webRoot: Flag.String('web-root').pipe(
      Flag.optional,
      Flag.withDescription(
        'Built web assets to serve. Defaults to the web/ directory next to the bundle; from source, pass ../web/dist.',
      ),
    ),
  },
  ({ config: path, port, webRoot }) =>
    Effect.gen(function* () {
      const loaded = yield* loadConfig(path);
      const config = Option.match(port, {
        onNone: () => loaded,
        onSome: (value) => ({ ...loaded, server: { ...loaded.server, port: value } }),
      });
      const root = Option.getOrElse(webRoot, () => bundledWebRoot);
      if (!existsSync(root)) {
        yield* Effect.logWarning(`No web assets at ${root}; serving the API only.`);
        return yield* serve(config);
      }
      return yield* serve(config, { webRoot: root });
    }).pipe(
      Effect.catchTag('ConfigError', (error) =>
        Effect.andThen(
          Console.error(error.message),
          Effect.sync(() => (process.exitCode = 1)),
        ),
      ),
    ),
).pipe(Command.withDescription('Serve the conversation API and the web player.'));

const fluidcast = Command.make('fluidcast').pipe(
  Command.withDescription('Fluidcast reference server.'),
  Command.withSubcommands([serveCommand]),
);

Command.run(fluidcast, { version: '0.0.0' }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
