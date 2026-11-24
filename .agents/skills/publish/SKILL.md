---
name: publish
description: Release Fluidcast packages to npm by agreeing new versions with the user, committing the bumps, and pushing one tag per package so CI publishes each in dependency order. Use when the user wants to publish, release, or cut a version of any Fluidcast package.
---

# Publish Fluidcast packages

Each public package under `packages/` versions independently. Releasing a package version means pushing one Git tag, `<package name without scope>/<version>` such as `fluidcast-react/0.2.1`. The tag triggers `.github/workflows/publish.yml`, which verifies the tag and publishes that one package to npm through trusted publishing. Publishing never happens from this machine and needs no npm login.

You own the judgment: what changed, what each version should be, and the conversation with the user. The scripts in `scripts/` own the facts that must be exact: publish order, safety checks, tag creation, and watching CI. Take order and readiness from their output, and create and push tags only through `release-tag.mjs`. Each script's header comment documents its arguments.

- `scripts/plan.mjs` reports branch state, every public package in publish order with its last tag, npm state, dependencies, and commits since that tag, then the pending tags, warnings, and blocking problems. It exits non-zero when something blocks a release. A package is pending when its committed version has no tag.
- `scripts/release-tag.mjs <tag>` releases one pending package: it re-checks it, pushes its tag, watches the workflow run, and returns once npm serves the version.
- `scripts/setup-trust.mjs` is the one-time trusted publisher setup. The user runs it, because it needs an interactive `npm login` with 2FA.

Invoking this skill is the user's explicit permission for the release's state-changing Git commands: the version commit, the push to `main`, and the tag pushes. Explicit instructions from the user in the conversation take precedence over this skill.

## Release

1. **Start from a releasable state.** Run `plan.mjs`. When it reports problems, explain each one and wait for the user to resolve them; pulling, pushing, or committing local work usually does. Relay its warnings, particularly packages that changed without a version bump and tags that never reached npm.
2. **Summarize the changes.** For each package with commits since its last tag, read the commits, and the diff where the messages are thin, and summarize the change in a sentence or two. Say so when a package has no earlier tag to compare against.
3. **Propose versions.** Suggest a version for each changed package with a one-line reason. Below `1.0.0`, a breaking change or a notable new capability bumps the minor version and everything else bumps the patch; from `1.0.0`, follow semver. Internal dependencies publish as exact pins, so for each dependency being released, name the dependents that are not: they keep pinning the old version, which can leave consumers with two copies of it. The user may change any version, add packages, or drop them.
4. **Confirm once.** Show the final `package: old -> new` list in the order `plan.mjs` gives and wait for the user's go-ahead. That go-ahead covers every remaining step, so continue through the last tag without asking again unless something fails.
5. **Bump and push.** Set the `version` field of each agreed package. `pnpm versions:sync <version>` sets every package at once when they all share one version. Run `pnpm check` and resolve failures before committing. Commit only the version changes, as `chore(release): <tag>, <tag>, ...` with no AI attribution, and `git push origin main`.
6. **Re-plan.** Run `plan.mjs` again. Continue only when its pending tags are exactly the agreed set and it reports no problems; otherwise explain the difference to the user.
7. **Release in order.** Run `release-tag.mjs` for each pending tag in `plan.mjs` order, in the foreground, one at a time, stopping at the first failure.

The release is done when every agreed version is on npm. Report what was released, and for anything that was not, why and what state it was left in.

When a publish run fails, a release stops partway, or a new public package needs its first release, read `references/recovery.md` before acting.
