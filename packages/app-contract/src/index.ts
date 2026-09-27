/**
 * The reference apps' HTTP contract: route paths, their bodies and error payloads, and the SSE
 * framing. A pure export: it imports only `effect` stable modules and the SDKs' pure contracts, so
 * the backend and any client transport can share it. It is not an SDK surface.
 *
 * Every failure body is a tagged error that an SDK already defines, except `InvalidRequest`, which
 * only this HTTP contract can produce. The `_tag` is the error code clients switch on.
 */
import { Schema } from 'effect';

import { SpeechError } from '@yourtechbudstudio/fluidcast-core/speech';
import {
  Command,
  CommandRejected,
  SpeechNotFound,
  SubscriptionMessage,
  ToolCommandRejected,
} from '@yourtechbudstudio/fluidcast-harness/protocol';

/** Route paths. `speech` takes the action ID as its last segment. */
export const routes = {
  /** `GET`: the session subscription as Server-Sent Events. */
  events: '/api/events',
  /** `POST`: one `Command` as a JSON body. */
  commands: '/api/commands',
  /** `GET`: the audio for one speak action, streamed. */
  speech: '/api/speech/:actionId',
} as const;

/** The path of the speech route for one action. */
export const speechPath = (actionId: string): string =>
  `/api/speech/${encodeURIComponent(actionId)}`;

// POST /api/commands

/** The request body: one command, as JSON. */
export const CommandBody = Command;

/**
 * Responses:
 * - `204`: applied (a stale `PlaybackFinished` is also applied, as a no-op);
 * - `409`: `CommandRejected` as JSON, or `ToolCommandRejected` for a `ToolCommand` whose execution
 *   is no longer open or whose payload the tool does not accept;
 * - `400`: `InvalidRequest` as JSON, when the body is not a valid command.
 */
export const commandStatus = { applied: 204, rejected: 409, invalid: 400 } as const;

/** The request could not be decoded. Carries no request content. */
export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()('InvalidRequest', {}) {}

export const CommandFailure = Schema.Union([CommandRejected, ToolCommandRejected, InvalidRequest]);
export type CommandFailure = typeof CommandFailure.Type;

// GET /api/speech/:actionId

/**
 * Responses:
 * - `200`: the audio, streamed, with `Content-Type` equal to the snapshot's `speech.mimeType`;
 * - `404`: `SpeechNotFound` as JSON;
 * - `502`: Core's `SpeechError` as JSON, when synthesis failed before any audio was sent.
 *
 * If synthesis fails after audio has started, the connection is aborted, so a truncated body never
 * looks complete.
 */
export const speechStatus = { ok: 200, notFound: 404, unavailable: 502 } as const;

export const SpeechFailure = Schema.Union([SpeechNotFound, SpeechError]);
export type SpeechFailure = typeof SpeechFailure.Type;

// GET /api/events

/**
 * SSE framing. Each subscription message is one event with a single `data:` line holding the
 * JSON-encoded `SubscriptionMessage`, and no `event:` or `id:` field. Comment lines (`: heartbeat`)
 * are sent periodically and carry nothing. The response ends after `Superseded`; ending without it
 * means the connection was lost.
 */
export const SubscriptionMessageJson = Schema.fromJsonString(SubscriptionMessage);

/** How often the server sends a heartbeat comment. */
export const heartbeatIntervalMillis = 15_000;
