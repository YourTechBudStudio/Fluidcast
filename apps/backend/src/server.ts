import { createServer } from 'node:http';

import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer';
import { Layer } from 'effect';
import { FetchHttpClient, HttpRouter } from 'effect/unstable/http';

import type { Config } from './config.ts';
import {
  activeSessionLayer,
  conversationRoutes,
  languageModelLayer,
} from './conversation/index.ts';
import { speechRoutes, synthesizerLayer } from './speech/index.ts';

/**
 * The whole reference backend as a Layer: the slices' routes, the one live session (started and
 * reset over `/api/session`) and the providers, on Node's HTTP server at `config.server`. Launch it
 * with `Layer.launch`.
 */
export const serverLayer = (config: Config) =>
  HttpRouter.serve(Layer.mergeAll(conversationRoutes, speechRoutes(config.speech.format))).pipe(
    Layer.provide(activeSessionLayer(config.conversation, config.speech.format)),
    // Provided once, so the whole server shares one model (and one ChatGPT sign-in).
    Layer.provide(
      Layer.merge(languageModelLayer(config.conversation.llm), synthesizerLayer(config.speech)),
    ),
    Layer.provide(FetchHttpClient.layer),
    // Shut down at once: waiting for open connections to drain would hold Ctrl+C on the
    // long-lived event stream, so in-flight requests are interrupted instead.
    Layer.provide(
      NodeHttpServer.layer(createServer, { ...config.server, disablePreemptiveShutdown: true }),
    ),
  );

/** Serves until interrupted. */
export const serve = (config: Config) => Layer.launch(serverLayer(config));
