import { createServer } from 'node:http';

import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer';
import { Layer } from 'effect';
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerResponse,
  HttpStaticServer,
} from 'effect/unstable/http';

import type { Config } from './config.ts';
import { conversationRoutes, sessionLayer } from './conversation/index.ts';
import { speechRoutes, synthesizerLayer } from './speech/index.ts';

export interface ServeOptions {
  /** A directory of built web assets to serve, with an `index.html` fallback outside `/api`. */
  readonly webRoot?: string;
}

/** The web app's files. Unknown `/api` paths stay `404` instead of falling back to the app. */
const webRoutes = (root: string) =>
  Layer.mergeAll(
    HttpStaticServer.layer({ root, spa: true }),
    HttpRouter.add('*', '/api/*', HttpServerResponse.empty({ status: 404 })),
  );

/**
 * The whole reference backend as a Layer: the slices' routes, the single Harness session and the
 * providers, on Node's HTTP server at `config.server`. Launch it with `Layer.launch`.
 */
export const serverLayer = (config: Config, options: ServeOptions = {}) =>
  HttpRouter.serve(
    Layer.mergeAll(
      conversationRoutes,
      speechRoutes(config.speech.format),
      options.webRoot === undefined ? Layer.empty : webRoutes(options.webRoot),
    ),
  ).pipe(
    Layer.provide(sessionLayer(config.conversation, config.speech.format)),
    Layer.provide(synthesizerLayer(config.speech)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(NodeHttpServer.layer(createServer, config.server)),
  );

/** Serves until interrupted. */
export const serve = (config: Config, options: ServeOptions = {}) =>
  Layer.launch(serverLayer(config, options));
