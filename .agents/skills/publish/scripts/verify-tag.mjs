// `node .agents/skills/publish/scripts/verify-tag.mjs <tag>`
//
// The publish workflow's gate. Resolves a tag such as `fluidcast-react/0.2.1` to its public package,
// checks that the committed version matches the tag and that every internal dependency's committed
// version is already on npm, and reports whether this version is already published. Results go to
// `$GITHUB_OUTPUT` when it is set, and to stdout either way.
import { appendFileSync } from 'node:fs';
import { distTagFor, isPublished, main, parseArgs, publicPackages, ReleaseError, repoRoot, tagFor, tagPrefix } from './lib.mjs';

main(() => {
  const { positional } = parseArgs(process.argv.slice(2));
  const [tag] = positional;
  if (tag === undefined) throw new ReleaseError('usage: verify-tag.mjs <tag>');

  const packages = publicPackages(repoRoot());
  const pkg = packages.find((candidate) => tag.startsWith(`${tagPrefix(candidate.name)}/`));
  if (pkg === undefined) throw new ReleaseError(`${tag} does not name a public package.`);
  if (tagFor(pkg.name, pkg.version) !== tag) {
    throw new ReleaseError(`${tag} does not match the committed version: ${pkg.name} is ${pkg.version} at this commit.`);
  }

  const byName = new Map(packages.map((candidate) => [candidate.name, candidate]));
  const missing = pkg.internalDependencies
    .map((name) => byName.get(name))
    .filter((dependency) => !isPublished(dependency.name, dependency.version))
    .map((dependency) => tagFor(dependency.name, dependency.version));
  if (missing.length > 0) {
    throw new ReleaseError(`${tag} needs versions that are not on npm yet; publish these first: ${missing.join(', ')}`);
  }

  const outputs = {
    name: pkg.name,
    version: pkg.version,
    dir: pkg.dir,
    dist_tag: distTagFor(pkg.version),
    published: String(isPublished(pkg.name, pkg.version)),
  };
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
});
