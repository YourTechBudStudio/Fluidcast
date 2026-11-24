// Facts the publish skill and the publish workflow both rely on: which packages are public, how a
// tag names a package version, the publish order, and what git and npm currently hold.
//
// Tags have the form `<package name without scope>/<version>`, e.g. `fluidcast-react/0.2.1`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** `MAJOR.MINOR.PATCH` with an optional prerelease such as `-rc.1`; no build metadata. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Dependency fields that ship to consumers; dev dependencies do not affect what installs. */
const RUNTIME_DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

export class ReleaseError extends Error {}

export const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();

export const repoRoot = () => run('git', ['rev-parse', '--show-toplevel']);

export const parseSemver = (version) => {
  const match = SEMVER.exec(version);
  if (match === null) return undefined;
  return { major: +match[1], minor: +match[2], patch: +match[3], prerelease: match[4] };
};

const comparePrerelease = (a, b) => {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const leftNumber = /^\d+$/.test(left[i]);
    const rightNumber = /^\d+$/.test(right[i]);
    if (leftNumber && rightNumber && +left[i] !== +right[i]) return +left[i] - +right[i];
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
};

/** Semver precedence; both arguments must be valid versions. */
export const compareVersions = (a, b) => {
  const left = parseSemver(a);
  const right = parseSemver(b);
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch ||
    comparePrerelease(left.prerelease, right.prerelease)
  );
};

export const tagPrefix = (name) => name.split('/').pop();
export const tagFor = (name, version) => `${tagPrefix(name)}/${version}`;

/** The npm dist-tag a version publishes under: prereleases never become `latest`. */
export const distTagFor = (version) => (parseSemver(version).prerelease === undefined ? 'latest' : 'next');

/** Every workspace package, as pnpm resolves the workspace. */
const workspacePackages = (root) => {
  const listed = JSON.parse(run('pnpm', ['ls', '--recursive', '--depth', '-1', '--json'], { cwd: root }));
  return listed
    .filter((entry) => entry.path !== root)
    .map((entry) => {
      const manifest = JSON.parse(readFileSync(join(entry.path, 'package.json'), 'utf8'));
      return { name: manifest.name, version: manifest.version, private: manifest.private === true, dir: relative(root, entry.path), manifest };
    });
};

/**
 * The public packages with their internal runtime dependencies, sorted so every package comes after
 * the packages it depends on. Throws on a cycle or on a public package that ships a dependency on a
 * private workspace package, since neither can be published correctly.
 */
export const publicPackages = (root) => {
  const all = workspacePackages(root);
  const byName = new Map(all.map((pkg) => [pkg.name, pkg]));
  const published = all.filter((pkg) => !pkg.private);
  for (const pkg of published) {
    if (parseSemver(pkg.version) === undefined) {
      throw new ReleaseError(`${pkg.name} has version ${JSON.stringify(pkg.version)}, which is not a semantic version.`);
    }
    pkg.internalDependencies = [
      ...new Set(RUNTIME_DEPENDENCY_FIELDS.flatMap((field) => Object.keys(pkg.manifest[field] ?? {}))),
    ]
      .filter((dependency) => byName.has(dependency))
      .sort();
    for (const dependency of pkg.internalDependencies) {
      if (byName.get(dependency).private) {
        throw new ReleaseError(`${pkg.name} depends at runtime on the private workspace package ${dependency}.`);
      }
    }
  }

  const ordered = [];
  const state = new Map();
  const visit = (pkg, path) => {
    if (state.get(pkg.name) === 'done') return;
    if (state.get(pkg.name) === 'visiting') {
      throw new ReleaseError(`dependency cycle: ${[...path, pkg.name].join(' -> ')}`);
    }
    state.set(pkg.name, 'visiting');
    for (const dependency of pkg.internalDependencies) visit(byName.get(dependency), [...path, pkg.name]);
    state.set(pkg.name, 'done');
    ordered.push(pkg);
  };
  for (const pkg of [...published].sort((a, b) => a.name.localeCompare(b.name))) visit(pkg, []);
  return ordered;
};

/** The versions git has tagged for a package, highest first. */
export const taggedVersions = (root, name) =>
  run('git', ['tag', '--list', `${tagPrefix(name)}/*`], { cwd: root })
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.slice(tagPrefix(name).length + 1))
    .filter((version) => parseSemver(version) !== undefined)
    .sort((a, b) => compareVersions(b, a));

/** The versions npm holds for a package; empty when the package has never been published. */
export const npmVersions = (name) => {
  try {
    const versions = JSON.parse(run('npm', ['view', name, 'versions', '--json']));
    return Array.isArray(versions) ? versions : [versions];
  } catch (error) {
    if (/E404/.test(String(error.stderr ?? error.message))) return [];
    throw new ReleaseError(`could not read ${name} from npm: ${String(error.stderr ?? error.message).trim()}`);
  }
};

export const isPublished = (name, version) => {
  try {
    return run('npm', ['view', `${name}@${version}`, 'version']) === version;
  } catch (error) {
    if (/E404/.test(String(error.stderr ?? error.message))) return false;
    throw new ReleaseError(`could not read ${name}@${version} from npm: ${String(error.stderr ?? error.message).trim()}`);
  }
};

/** Parses `--flag` and `--key=value` arguments; everything else is positional. */
export const parseArgs = (argv) => {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    const match = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
    if (match === null) positional.push(arg);
    else flags[match[1]] = match[2] ?? true;
  }
  return { flags, positional };
};

/** Runs a script body, printing a `ReleaseError` as a one-line failure instead of a stack trace. */
export const main = (body) => {
  try {
    body();
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
};
