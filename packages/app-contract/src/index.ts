/**
 * The reference apps' HTTP contract: route paths, their bodies and error payloads, and the SSE
 * framing. A pure export: it imports only `effect` stable modules and the SDKs' pure contracts, so
 * the backend and any client transport can share it. It is not an SDK surface.
 *
 * Every failure body is a tagged error that an SDK already defines, except `InvalidRequest` and the
 * session lifecycle's errors, which only this HTTP contract can produce. The `_tag` is the error
 * code clients switch on.
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

/** Route paths. Every per-session route names the backend session it addresses. */
export const routes = {
  /** `GET`: `SessionStatus` as SSE (current, then each change). `POST`: `StartRequest` → `204`. */
  session: '/api/session',
  /** `DELETE`: Reset this session → `204`, or `404 NoSession` if it is not the live one. */
  activeSession: '/api/session/:sessionId',
  /** `GET`: the session subscription as Server-Sent Events. */
  events: '/api/session/:sessionId/events',
  /** `POST`: one `Command` as a JSON body. */
  commands: '/api/session/:sessionId/commands',
  /** `GET`: the audio for one speak action, streamed. */
  speech: '/api/session/:sessionId/speech/:actionId',
  /** `GET`: the worker's status as Server-Sent Events, one `WorkerSummary` per change. */
  worker: '/api/session/:sessionId/worker',
  /** `GET`: the worker's transcript as SSE: a `TranscriptSnapshot`, then `TranscriptAppended`s. */
  workerTranscript: '/api/session/:sessionId/worker/transcript',
} as const;

/** The per-session paths for one backend session, each segment URI-encoded. */
export const sessionPaths = (sessionId: string) => {
  const base = `/api/session/${encodeURIComponent(sessionId)}`;
  return {
    session: base,
    events: `${base}/events`,
    commands: `${base}/commands`,
    speech: (actionId: string) => `${base}/speech/${encodeURIComponent(actionId)}`,
    worker: `${base}/worker`,
    workerTranscript: `${base}/worker/transcript`,
  };
};

/** The request could not be decoded. Carries no request content. */
export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()('InvalidRequest', {}) {}

// Session lifecycle: GET, POST /api/session and DELETE /api/session/:sessionId

/** Which backend session is live. `id` is the backend's own ID (a UUIDv7 per start), not Claude's. */
export const SessionStatus = Schema.Union([
  Schema.TaggedStruct('NoSession', {}),
  Schema.TaggedStruct('Active', { id: Schema.String }),
]);
export type SessionStatus = typeof SessionStatus.Type;
export const SessionStatusJson = Schema.fromJsonString(SessionStatus);

/** `POST /api/session`: a new brainstorm, or a stored Claude Code session to continue (raw input). */
export const StartRequest = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('new') }),
  Schema.Struct({ mode: Schema.Literal('continue'), sessionId: Schema.String }),
]);
export type StartRequest = typeof StartRequest.Type;

/** The session could not be started. Identifiers only. */
export class StartFailed extends Schema.TaggedError<StartFailed>()('StartFailed', {
  reason: Schema.Literals(['InvalidSessionId', 'SessionNotFound', 'SessionUnreadable', 'NoAnswer']),
}) {}
/** A session is already live: Reset it first. */
export class SessionActive extends Schema.TaggedError<SessionActive>()('SessionActive', {}) {}
/** The addressed session is not the live one: it was discarded, or never existed. */
export class NoSession extends Schema.TaggedError<NoSession>()('NoSession', {}) {}

/** `POST /api/session`: `204`; `400 InvalidRequest`; `409 SessionActive`; `422 StartFailed`. */
export const startStatus = { started: 204, invalid: 400, active: 409, failed: 422 } as const;
export const StartFailure = Schema.Union([StartFailed, SessionActive, InvalidRequest]);
export type StartFailure = typeof StartFailure.Type;
/** `DELETE /api/session/:sessionId`: `204` once discarded and its worker's query closed; `404 NoSession`. */
export const resetStatus = { reset: 204, gone: 404 } as const;
/** Every per-session route answers `404 NoSession` for a session that is not live. */
export const noSessionStatus = 404;

// POST /api/session/:sessionId/commands

/** The request body: one command, as JSON. */
export const CommandBody = Command;

/**
 * Responses:
 * - `204`: applied (a stale `PlaybackFinished` is also applied, as a no-op);
 * - `409`: `CommandRejected` as JSON, or `ToolCommandRejected` for a `ToolCommand` whose execution
 *   is no longer open or whose payload the tool does not accept;
 * - `400`: `InvalidRequest` as JSON, when the body is not a valid command;
 * - `404`: `NoSession` as JSON, when the session is not the live one.
 */
export const commandStatus = { applied: 204, rejected: 409, invalid: 400 } as const;

export const CommandFailure = Schema.Union([
  CommandRejected,
  ToolCommandRejected,
  InvalidRequest,
  NoSession,
]);
export type CommandFailure = typeof CommandFailure.Type;

// GET /api/session/:sessionId/speech/:actionId

/**
 * Responses:
 * - `200`: the audio, streamed, with `Content-Type` equal to the snapshot's `speech.mimeType`;
 * - `404`: `SpeechNotFound` as JSON, or `NoSession` when the session is not the live one;
 * - `502`: Core's `SpeechError` as JSON, when synthesis failed before any audio was sent.
 *
 * If synthesis fails after audio has started, the connection is aborted, so a truncated body never
 * looks complete.
 */
export const speechStatus = { ok: 200, notFound: 404, unavailable: 502 } as const;

export const SpeechFailure = Schema.Union([SpeechNotFound, SpeechError, NoSession]);
export type SpeechFailure = typeof SpeechFailure.Type;

// GET /api/session/:sessionId/events

/**
 * SSE framing. Each subscription message is one event with a single `data:` line holding the
 * JSON-encoded `SubscriptionMessage`, and no `event:` or `id:` field. Comment lines (`: heartbeat`)
 * are sent periodically and carry nothing. The response ends after `Superseded`; ending without it
 * means the connection was lost. The response also ends, without `Superseded`, when the session is
 * discarded; reconnecting then gets `404 NoSession`.
 */
export const SubscriptionMessageJson = Schema.fromJsonString(SubscriptionMessage);

/** How often the server sends a heartbeat comment. */
export const heartbeatIntervalMillis = 15_000;

// GET /api/session/:sessionId/worker and GET /api/session/:sessionId/worker/transcript

/**
 * Responses: `200`, SSE with the same framing as the events route (one `data:` line per message,
 * heartbeat comments), each message JSON-encoded with the Forward tool's `WorkerSummaryJson` or
 * `TranscriptMessageJson` (`fluidcast-tool-agent/schema`, which owns the Worker surface). `404
 * NoSession` once the session is discarded. The stream also ends when the session is discarded.
 */
export const workerStatus = { ok: 200 } as const;
