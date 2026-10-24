/**
 * Listing a Codex worker's skills through a short-lived app-server, with the transport as a
 * parameter so it can be driven by synthetic replies. It starts no turn. Internal: the `./codex`
 * entry builds `listSkills` from it.
 */
import { Effect, Schema } from 'effect';

import type { Skill, SkillsUnavailable } from '../schema.ts';
import { boundedListing } from '../worker.ts';
import type { OpenTransport } from './process.ts';
import { SkillsListResponse } from './protocol.ts';
import { failureAnnotations, shortLived } from './rpc.ts';

/** The enabled skills of a worker in `cwd`, from `skills/list` in a fresh app-server. */
export const listSkillsWith =
  (open: OpenTransport) =>
  (cwd: string): Effect.Effect<ReadonlyArray<Skill>, SkillsUnavailable> =>
    boundedListing(
      shortLived(open, (rpc) =>
        rpc
          .request('skills/list', { cwds: [cwd] })
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(SkillsListResponse))),
      ).pipe(
        Effect.map(({ data }) =>
          data.flatMap((entry) =>
            entry.skills.flatMap((skill) =>
              skill.enabled ? [{ name: skill.name, description: skill.description }] : [],
            ),
          ),
        ),
      ),
      (error) =>
        Effect.logWarning('codex: skills unavailable').pipe(
          Effect.annotateLogs(failureAnnotations(error)),
        ),
    );
