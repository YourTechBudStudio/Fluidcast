# Recovering a release

An npm version can be published only once, ever, even after it is unpublished. A tag whose version never reached npm can be deleted and recreated freely. Every recovery choice follows from those two facts.

## A publish run failed

The tag exists, but npm does not serve the version. Read the run's log with the `gh run view <id> --log-failed` command that `release-tag.mjs` printed, and confirm the cause before acting.

- **The cause is transient**, such as a network or registry error. Rerun the run with `gh run rerun <id>`, follow it with `gh run watch <id> --exit-status`, and once npm serves the version, continue with the next pending tag. The workflow skips versions that are already on npm, so a rerun never publishes twice.
- **The code or workflow needs a fix.** Delete the tag locally and on `origin` (`git tag --delete <tag>` and `git push origin :refs/tags/<tag>`), land the fix on `main`, and resume from step 5 of the release at the same version.
- **The version reached npm, but something about it is wrong.** It cannot be published again. Agree a new version with the user and release that instead.

## The release stopped partway

Run `plan.mjs`. Released packages are no longer pending, so continue step 7 with the tags it still lists.

## A new public package

npm can attach a trusted publisher only to a package that already exists. The user publishes a `0.0.0-stage` placeholder by hand, as the existing packages have, then runs `node .agents/skills/publish/scripts/setup-trust.mjs <package name>`. Its first real version, and every later one, is released through this skill.
