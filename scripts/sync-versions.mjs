// `pnpm versions:sync [version]`: gives every workspace package the root's version.
//
// Fluidcast releases its packages in lockstep, and the root `package.json` is the only version
// authority. With a version argument, the root is set to it first; without one, the root's current
// version is spread as it stands. Only `version` fields change.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** `MAJOR.MINOR.PATCH` with an optional prerelease such as `-rc.1`; no build metadata. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

class SyncError extends Error {}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const checkVersion = (version, label) => {
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new SyncError(`${label} ${JSON.stringify(version)} is not a semantic version.`);
  }
  return version;
};

/** The `dir/*` globs under `packages:` in `pnpm-workspace.yaml`. */
const workspacePatterns = () => {
  const patterns = [];
  let inPackages = false;
  for (const line of readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').split(/\r?\n/)) {
    if (line === 'packages:') {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item === null) break;
    const pattern = item[1].trim().replace(/^['"]|['"]$/g, '');
    if (!/^[\w.-]+\/\*$/.test(pattern)) {
      throw new SyncError(`unsupported workspace pattern ${JSON.stringify(pattern)}.`);
    }
    patterns.push(pattern);
  }
  if (patterns.length === 0) throw new SyncError('pnpm-workspace.yaml lists no packages.');
  return patterns;
};

const workspaceManifests = () =>
  workspacePatterns().flatMap((pattern) => {
    const parent = join(root, pattern.slice(0, -2));
    if (!existsSync(parent)) return [];
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name, 'package.json'))
      .filter((path) => existsSync(path));
  });

/** Returns whether the file changed. */
const syncManifest = (path, version) => {
  const manifest = readJson(path);
  if (manifest.version === version) return false;
  writeFileSync(path, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  return true;
};

const main = (argv) => {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (args.length > 1) throw new SyncError('usage: pnpm versions:sync [version]');

  const rootPath = join(root, 'package.json');
  const version =
    args[0] === undefined
      ? checkVersion(readJson(rootPath).version, 'the root "version"')
      : checkVersion(args[0], 'the requested version');

  const changed = [rootPath, ...workspaceManifests()].filter((path) => syncManifest(path, version));
  const listing = changed.map((path) => `  ${relative(root, path)}`).join('\n');
  return changed.length === 0
    ? `Everything is already at ${version}.`
    : `Set ${version} in ${changed.length} file(s):\n${listing}`;
};

try {
  process.stdout.write(`${main(process.argv.slice(2))}\n`);
} catch (error) {
  if (!(error instanceof SyncError)) throw error;
  process.stderr.write(`Version sync failed: ${error.message}\n`);
  process.exitCode = 1;
}
