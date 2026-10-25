import { Effect, Layer, Schema, Stream } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

import { routes, SkillsFailure, SkillsJson, skillsStatus } from '@fluidcast/app-contract';
import {
  TranscriptMessageJson,
  WorkerSummaryJson,
} from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { liveSession, noSessionResponse } from './session-routes.ts';
import { logConnection, sseResponse } from './sse.ts';

const encodeSummary = Schema.encodeSync(WorkerSummaryJson);
const encodeTranscript = Schema.encodeSync(TranscriptMessageJson);
const encodeSkills = Schema.encodeSync(SkillsJson);
const failureJson = HttpServerResponse.schemaJson(SkillsFailure);
const SessionParams = Schema.Struct({ sessionId: Schema.String });

/**
 * `GET /api/session/:sessionId/worker`: the worker's status as SSE, one `WorkerSummary` per
 * change, until the session is discarded. `404 NoSession` for a session that is not live.
 */
const status = HttpRouter.add(
  'GET',
  routes.worker,
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(SessionParams);
    const live = yield* liveSession(sessionId);
    return sseResponse(
      live.bound(live.worker.status).pipe(
        Stream.map((summary) => encodeSummary(summary)),
        logConnection('worker'),
      ),
    );
  }).pipe(Effect.catchTags({ NoSession: noSessionResponse }), Effect.orDie),
);

/**
 * `GET /api/session/:sessionId/worker/transcript`: the worker's transcript as SSE, a snapshot then
 * appended entries, until the session is discarded. `404 NoSession` for a session that is not live.
 */
const transcript = HttpRouter.add(
  'GET',
  routes.workerTranscript,
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(SessionParams);
    const live = yield* liveSession(sessionId);
    return sseResponse(
      live.bound(live.worker.transcript).pipe(
        Stream.map((message) => encodeTranscript(message)),
        logConnection('worker transcript'),
      ),
    );
  }).pipe(Effect.catchTags({ NoSession: noSessionResponse }), Effect.orDie),
);

/**
 * `GET /api/session/:sessionId/worker/skills`: the worker's skills as JSON, listed once per session.
 * `502 SkillsUnavailable` when they could not be listed (the worker type has logged why); `404
 * NoSession` for a session that is not live.
 */
const skills = HttpRouter.add(
  'GET',
  routes.workerSkills,
  Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.schemaPathParams(SessionParams);
    const live = yield* liveSession(sessionId);
    const listed = yield* live.worker.skills;
    return HttpServerResponse.text(encodeSkills(listed), {
      status: skillsStatus.ok,
      contentType: 'application/json',
    });
  }).pipe(
    Effect.catchTags({
      NoSession: noSessionResponse,
      SkillsUnavailable: (error) =>
        Effect.logInfo('worker skills: unavailable').pipe(
          Effect.annotateLogs({ reason: error.reason }),
          Effect.andThen(failureJson(error, { status: skillsStatus.unavailable })),
        ),
    }),
    Effect.orDie,
  ),
);

/** The Worker view's routes. They need `ActiveSession`. */
export const workerRoutes = Layer.mergeAll(status, transcript, skills);
