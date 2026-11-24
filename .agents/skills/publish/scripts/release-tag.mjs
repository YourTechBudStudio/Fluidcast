// `node .agents/skills/publish/scripts/release-tag.mjs <package name or tag> [--dry-run]`
//
// Releases one package version: re-checks that HEAD is a pushed, clean `main` whose committed version
// is untagged and whose internal dependencies are on npm, creates the annotated tag, pushes it alone,
// watches the publish workflow it triggers, and waits until npm serves the version. Exits non-zero at
// the first failure, leaving everything before it in place.
import { execFileSync } from 'node:child_process';
import { isPublished, main, parseArgs, publicPackages, ReleaseError, repoRoot, run, tagFor, tagPrefix } from './lib.mjs';

const WORKFLOW = 'publish.yml';
const RUN_APPEAR_TIMEOUT_MS = 2 * 60_000;
const NPM_VISIBLE_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 5_000;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const waitFor = (label, timeoutMs, probe) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new ReleaseError(`timed out waiting for ${label}.`);
    sleep(POLL_MS);
  }
};

main(() => {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [target] = positional;
  if (target === undefined) throw new ReleaseError('usage: release-tag.mjs <package name or tag> [--dry-run]');
  const root = repoRoot();
  const git = (...args) => run('git', args, { cwd: root });

  const packages = publicPackages(root);
  const pkg = packages.find(
    (candidate) => candidate.name === target || target === tagPrefix(candidate.name) || target.startsWith(`${tagPrefix(candidate.name)}/`),
  );
  if (pkg === undefined) throw new ReleaseError(`${target} does not name a public package.`);
  const tag = tagFor(pkg.name, pkg.version);
  if (target.includes('/') && !target.startsWith('@') && target !== tag) {
    throw new ReleaseError(`${target} does not match the committed version: ${pkg.name} is ${pkg.version}.`);
  }

  git('fetch', '--quiet', '--tags', 'origin', 'main');
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') throw new ReleaseError('HEAD is not on main.');
  if (git('status', '--porcelain') !== '') throw new ReleaseError('the working tree has uncommitted changes.');
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) throw new ReleaseError('HEAD is not exactly origin/main.');
  if (git('tag', '--list', tag) !== '') throw new ReleaseError(`${tag} already exists.`);
  if (isPublished(pkg.name, pkg.version)) throw new ReleaseError(`${pkg.name}@${pkg.version} is already on npm.`);
  const byName = new Map(packages.map((candidate) => [candidate.name, candidate]));
  const missing = pkg.internalDependencies
    .map((name) => byName.get(name))
    .filter((dependency) => !isPublished(dependency.name, dependency.version))
    .map((dependency) => tagFor(dependency.name, dependency.version));
  if (missing.length > 0) throw new ReleaseError(`release these first: ${missing.join(', ')}`);

  const head = git('rev-parse', 'HEAD');
  if (flags['dry-run'] === true) {
    console.log(`would tag ${tag} at ${head.slice(0, 7)}, push it, watch ${WORKFLOW}, and wait for npm.`);
    return;
  }

  git('tag', '--annotate', tag, '--message', `${pkg.name}@${pkg.version}`);
  git('push', '--quiet', 'origin', `refs/tags/${tag}`);
  console.log(`pushed ${tag} at ${head.slice(0, 7)}; waiting for the ${WORKFLOW} run.`);

  const runId = waitFor(`the ${WORKFLOW} run for ${tag}`, RUN_APPEAR_TIMEOUT_MS, () => {
    const runs = JSON.parse(
      run('gh', ['run', 'list', '--workflow', WORKFLOW, '--branch', tag, '--event', 'push', '--json', 'databaseId,headSha', '--limit', '5'], { cwd: root }),
    );
    return runs.find((candidate) => candidate.headSha === head)?.databaseId;
  });
  try {
    execFileSync('gh', ['run', 'watch', String(runId), '--exit-status', '--interval', '10'], { cwd: root, stdio: 'inherit' });
  } catch {
    throw new ReleaseError(`the publish run for ${tag} failed: gh run view ${runId} --log-failed`);
  }

  waitFor(`npm to serve ${pkg.name}@${pkg.version}`, NPM_VISIBLE_TIMEOUT_MS, () => isPublished(pkg.name, pkg.version));
  console.log(`released ${pkg.name}@${pkg.version}`);
});
