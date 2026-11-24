---
name: publish
description: Release Fluidcast packages to npm. Use when the user says they want to publish, release, or cut a version of one or more packages. Finds what changed since each package's last tag, agrees new versions with the user, bumps and pushes them, then pushes one tag per package in dependency order and waits for CI to publish each.
---

# Publish Fluidcast packages

Each public package under `packages/` versions independently. A release of one package version is one Git tag, `<package name without scope>/<version>` (for example `fluidcast-react/0.2.1`), pushed to GitHub. The tag triggers `.github/workflows/publish.yml`, which verifies it and publishes that package to npm through trusted publishing. Nothing publishes from a laptop and no npm login is involved.

You do the judgment: what changed, what each version should be, and the conversation with the user. The scripts in `scripts/` do the facts: publish order, safety checks, tagging, and watching CI. Use their output instead of working those facts out yourself, and do not tag or push tags by hand.

Invoking this skill is the user's explicit permission for the state-changing Git commands below (version commit, push to `main`, tag pushes). It does not cover anything else, and you still confirm the final plan before the first commit.

## Scripts

Run them from the repository root.

- `node .agents/skills/publish/scripts/plan.mjs [--json] [--no-fetch]` fetches `origin`, then reports the branch state, every public package in publish order with its version, last tag, npm state, internal dependencies and commits since its last tag, the pending tags in publish order, warnings, and blocking problems. It exits non-zero when anything blocks tagging. A package is pending when its committed version has no tag.
- `node .agents/skills/publish/scripts/release-tag.mjs <package or tag> [--dry-run]` re-checks one pending package, creates and pushes its tag, watches the workflow run, and waits until npm serves the version.
- `node .agents/skills/publish/scripts/setup-trust.mjs [package...] [--dry-run]` is the one-time trusted publishing setup. The user runs it themselves, since it needs an interactive `npm login` with 2FA. For a newly added package, pass its name; npm refuses packages that already have a trusted publisher.

## Steps

1. **Check the starting point.** Run `plan.mjs`. If it reports problems, explain them and stop until the user resolves them. Typical fixes are pulling, pushing, or committing local work. Mention warnings, especially packages that changed without a version bump and tags that never reached npm (see Recovery).
2. **Summarize the changes.** For each package with commits since its last tag, read those commits (`git log <last tag>..HEAD -- <dir>`, and the diff where the messages are not enough) and summarize what changed in a sentence or two. A package with no previous tag has no baseline; say so.
3. **Propose versions.** Suggest a version for each changed package and explain why. Below `1.0.0`, a breaking change bumps the minor version, and so does a notable new capability; everything else bumps the patch. From `1.0.0`, follow semver. `workspace:*` publishes as an exact pin, so when a dependency is released, point out its dependents: they keep the old pin unless they are released too, which can leave consumers with two copies of a package. Let the user change any version, add packages, or drop them.
4. **Confirm the plan.** Show the final list of `package: old -> new` in publish order (the order from `plan.mjs`). Wait for the user's go-ahead.
5. **Bump and push.** Edit the `version` field of each agreed package's `package.json`. When every package moves to the same version, `pnpm versions:sync <version>` does it in one step. Run `pnpm check` and fix or report failures before going further. Commit the version changes alone as `chore(release): <tag>, <tag>, ...` with no AI attribution, then `git push origin main`. If the push is rejected, stop and tell the user.
6. **Re-plan.** Run `plan.mjs` again. Its pending tags must be exactly the agreed set and it must report no problems. If not, stop and explain the difference.
7. **Release in order.** For each pending tag in the order `plan.mjs` prints, run `release-tag.mjs <tag>` in the foreground and let it finish before starting the next. Stop at the first failure.
8. **Report.** List what reached npm, and anything that did not with the reason.

## Recovery

- **A publish run failed.** The tag exists but npm does not have the version. Read the failure with the `gh run view` command the script printed. For a transient failure, rerun it with `gh run rerun <id>`; the workflow publishes nothing twice. When the code or workflow needs a fix, delete the tag locally and on `origin`, fix it on `main` through steps 5 to 7 at the same version, and continue. A version that never reached npm can be re-tagged. A version that reached npm can never be published again; bump instead.
- **Release stopped partway.** Run `plan.mjs`. Released packages are no longer pending, so continue step 7 with the remaining tags.
- **A new public package.** It needs a first manual `npm publish` by the user, because npm can only attach a trusted publisher to a package that exists. After that, the user runs `setup-trust.mjs <package>`, and later releases go through this skill.
