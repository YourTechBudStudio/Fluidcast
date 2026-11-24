// `node .agents/skills/publish/scripts/setup-trust.mjs [package...] [--dry-run]`
//
// One-time setup: lets this repository's publish workflow publish every public package through npm
// trusted publishing, so no npm token exists anywhere. Needs an interactive `npm login` on an account
// with 2FA and write access; the first call asks for 2FA, and npm offers to skip it for five minutes.
// Without package names it covers every public package. A package that already has a trusted
// publisher makes npm refuse; see `npm trust list <package>`.
import { execFileSync } from 'node:child_process';
import { main, parseArgs, publicPackages, ReleaseError, repoRoot, run } from './lib.mjs';

const WORKFLOW_FILE = 'publish.yml';

/** `owner/repo` from a GitHub remote such as `git@github.com:owner/repo.git`. */
const githubRepository = (root) => {
  const url = run('git', ['remote', 'get-url', 'origin'], { cwd: root });
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (match === null) throw new ReleaseError(`origin is not a GitHub repository: ${url}`);
  return match[1];
};

main(() => {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const repository = githubRepository(root);
  const packages = publicPackages(root).filter((pkg) => positional.length === 0 || positional.includes(pkg.name));
  const unknown = positional.filter((name) => !packages.some((pkg) => pkg.name === name));
  if (unknown.length > 0) throw new ReleaseError(`not public packages: ${unknown.join(', ')}`);
  for (const [index, pkg] of packages.entries()) {
    const args = ['trust', 'github', pkg.name, '--file', WORKFLOW_FILE, '--repo', repository, '--allow-publish', '--yes'];
    console.log(`npm ${args.join(' ')}`);
    if (flags['dry-run'] === true) continue;
    // npm recommends a pause between calls to stay under its rate limit.
    if (index > 0) execFileSync('sleep', ['2']);
    execFileSync('npm', args, { cwd: root, stdio: 'inherit' });
  }
});
