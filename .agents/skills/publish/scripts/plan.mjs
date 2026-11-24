// `node .agents/skills/publish/scripts/plan.mjs [--no-fetch] [--json]`
//
// Reports what a release would do right now: the state of the local branch, every public package in
// publish order with its version, tags, npm state, and changes since its last tag, and the problems
// that block tagging. A package is pending when its committed version has no tag yet. Reads only;
// apart from fetching `origin`, it changes nothing.
import { compareVersions, main, npmVersions, parseArgs, publicPackages, repoRoot, run, taggedVersions, tagFor } from './lib.mjs';

const RELEASE_BRANCH = 'main';

const gitState = (root, fetch) => {
  if (fetch) run('git', ['fetch', '--quiet', '--tags', 'origin', RELEASE_BRANCH], { cwd: root });
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
  const dirty = run('git', ['status', '--porcelain'], { cwd: root });
  const [behind, ahead] = run('git', ['rev-list', '--left-right', '--count', `origin/${RELEASE_BRANCH}...HEAD`], { cwd: root })
    .split(/\s+/)
    .map(Number);
  return { branch, head: run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }), clean: dirty === '', ahead, behind };
};

const changesSince = (root, tag, dir) => {
  if (tag === undefined) return undefined;
  const log = run('git', ['log', '--format=%h %s', `${tag}..HEAD`, '--', dir], { cwd: root });
  return log === '' ? [] : log.split('\n');
};

const plan = (root, fetch) => {
  const git = gitState(root, fetch);
  const problems = [];
  const warnings = [];
  if (git.branch !== RELEASE_BRANCH) problems.push(`HEAD is on ${git.branch}; releases are tagged on ${RELEASE_BRANCH}.`);
  if (!git.clean) problems.push('the working tree has uncommitted changes.');
  if (git.behind > 0) problems.push(`HEAD is ${git.behind} commit(s) behind origin/${RELEASE_BRANCH}; pull first.`);
  if (git.ahead > 0) problems.push(`HEAD is ${git.ahead} commit(s) ahead of origin/${RELEASE_BRANCH}; push first so tags point at commits GitHub has.`);

  const packages = publicPackages(root).map((pkg) => {
    const tags = taggedVersions(root, pkg.name);
    const npm = npmVersions(pkg.name);
    const lastTag = tags[0] === undefined ? undefined : tagFor(pkg.name, tags[0]);
    const tagged = tags.includes(pkg.version);
    const published = npm.includes(pkg.version);
    const npmLatest = [...npm].sort(compareVersions).pop();
    return {
      name: pkg.name,
      dir: pkg.dir,
      version: pkg.version,
      tag: tagFor(pkg.name, pkg.version),
      pending: !tagged,
      tagged,
      published,
      lastTag,
      npmLatest,
      internalDependencies: pkg.internalDependencies,
      changesSinceLastTag: changesSince(root, lastTag, pkg.dir),
    };
  });
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));

  for (const pkg of packages) {
    if (pkg.pending && pkg.published) {
      problems.push(`${pkg.name}@${pkg.version} is already on npm but has no tag; bump it to a new version.`);
    }
    if (pkg.pending && pkg.lastTag !== undefined && compareVersions(pkg.version, pkg.lastTag.split('/').pop()) <= 0) {
      problems.push(`${pkg.name}@${pkg.version} is not above its last tag ${pkg.lastTag}.`);
    }
    if (pkg.pending && pkg.npmLatest !== undefined && !pkg.published && compareVersions(pkg.version, pkg.npmLatest) <= 0) {
      problems.push(`${pkg.name}@${pkg.version} is not above ${pkg.npmLatest}, the highest version on npm.`);
    }
    if (pkg.tagged && !pkg.published) {
      warnings.push(`${pkg.tag} is tagged but not on npm: its publish is still running or failed.`);
    }
    if (!pkg.pending && (pkg.changesSinceLastTag?.length ?? 0) > 0) {
      warnings.push(`${pkg.name} has ${pkg.changesSinceLastTag.length} commit(s) since ${pkg.lastTag} but its version was not bumped.`);
    }
    if (pkg.pending) {
      for (const dependencyName of pkg.internalDependencies) {
        const dependency = byName.get(dependencyName);
        if (!dependency.pending && !dependency.published) {
          problems.push(`${pkg.name}@${pkg.version} needs ${dependency.name}@${dependency.version}, which is tagged but not on npm yet.`);
        }
      }
    }
  }

  // `workspace:*` publishes as an exact pin, so a dependent that is not re-released stays on the old
  // version of whatever is being released. That is sometimes intended, so it only warns.
  for (const pkg of packages) {
    if (!pkg.pending) continue;
    const dependents = packages.filter((other) => !other.pending && other.internalDependencies.includes(pkg.name));
    if (dependents.length > 0) {
      warnings.push(
        `${pkg.name} is being released, but ${dependents.map((other) => other.name).join(', ')} keep(s) depending on the version they were published with.`,
      );
    }
  }

  return { git, order: packages.map((pkg) => pkg.name), pending: packages.filter((pkg) => pkg.pending).map((pkg) => pkg.tag), packages, problems, warnings };
};

const print = (result) => {
  const { git } = result;
  console.log(`branch ${git.branch} @ ${git.head}  clean=${git.clean}  ahead=${git.ahead}  behind=${git.behind}\n`);
  for (const pkg of result.packages) {
    const state = pkg.pending ? 'PENDING' : pkg.published ? 'released' : 'tagged, not on npm';
    console.log(`${pkg.name}@${pkg.version}  [${state}]  last tag: ${pkg.lastTag ?? 'none'}  npm latest: ${pkg.npmLatest ?? 'none'}`);
    if (pkg.internalDependencies.length > 0) console.log(`  depends on: ${pkg.internalDependencies.join(', ')}`);
    if (pkg.changesSinceLastTag === undefined) console.log('  changes: no previous tag');
    else console.log(`  changes since ${pkg.lastTag}: ${pkg.changesSinceLastTag.length} commit(s)`);
  }
  console.log(`\npublish order: ${result.pending.length === 0 ? 'nothing pending' : result.pending.join(' -> ')}`);
  for (const warning of result.warnings) console.log(`warning: ${warning}`);
  for (const problem of result.problems) console.log(`problem: ${problem}`);
};

main(() => {
  const { flags } = parseArgs(process.argv.slice(2));
  const result = plan(repoRoot(), flags['no-fetch'] !== true);
  if (flags.json === true) console.log(JSON.stringify(result, null, 2));
  else print(result);
  if (result.problems.length > 0) process.exitCode = 1;
});
