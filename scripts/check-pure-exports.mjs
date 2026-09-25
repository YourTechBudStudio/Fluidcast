// Checks that pure contract entry points import only allowed modules, so they stay safe to load in
// any environment (browser, server, CLI) without pulling in providers, servers or runtimes.
//
// Allowed:
// - relative imports that stay inside the entry's own module directory (followed transitively);
// - `effect` and its stable top-level modules such as `effect/Schema` (nothing under `effect/unstable/`);
// - other pure entries, by package specifier.
// Everything else fails, including type-only imports.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSync } from 'oxc-parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Pure entries: package specifier → source entry file. Add one line per new pure export. */
const pureEntries = {
  '@yourtechbudstudio/fluidcast-core/actions': 'packages/core/src/actions/index.ts',
  '@yourtechbudstudio/fluidcast-core/speech': 'packages/core/src/speech/index.ts',
  '@yourtechbudstudio/fluidcast-harness/protocol': 'packages/harness/src/session/protocol.ts',
  '@yourtechbudstudio/fluidcast-client': 'packages/client/src/index.ts',
  '@fluidcast/app-contract': 'packages/app-contract/src/index.ts',
};

/**
 * Every module a file imports or re-exports, from the parser's module records, so comments, strings
 * and formatting cannot hide an import. A dynamic import of anything but a string literal cannot be
 * verified and is reported as `undefined`.
 */
const moduleSpecifiers = (file, text) => {
  const { errors, module } = parseSync(file, text);
  if (errors.length > 0) return { error: errors[0].message };
  const dynamic = module.dynamicImports.map(({ moduleRequest }) => {
    const source = text.slice(moduleRequest.start, moduleRequest.end).trim();
    return /^(['"])[^'"\\]*\1$/.test(source) ? source.slice(1, -1) : undefined;
  });
  return {
    specifiers: [
      ...module.staticImports.map((entry) => entry.moduleRequest.value),
      ...module.staticExports.flatMap((entry) =>
        entry.entries.flatMap((exported) => exported.moduleRequest?.value ?? []),
      ),
      ...dynamic,
    ],
  };
};

const isAllowedPackage = (specifier) =>
  specifier === 'effect' || /^effect\/[A-Za-z]+$/.test(specifier) || specifier in pureEntries;

const violations = [];

for (const [entry, source] of Object.entries(pureEntries)) {
  const entryFile = resolve(root, source);
  const moduleDirectory = dirname(entryFile);
  const pending = [entryFile];
  const visited = new Set();

  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const where = relative(root, file);
    if (!existsSync(file)) {
      violations.push(`${entry}: ${where} does not exist`);
      continue;
    }
    const { error, specifiers } = moduleSpecifiers(file, readFileSync(file, 'utf8'));
    if (error !== undefined) {
      violations.push(`${entry}: ${where} could not be parsed: ${error}`);
      continue;
    }
    for (const specifier of specifiers) {
      if (specifier === undefined) {
        violations.push(`${entry}: ${where} has a dynamic import that is not a string literal`);
      } else if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(moduleDirectory + sep)) {
          violations.push(`${entry}: ${where} imports '${specifier}', which leaves the module`);
        } else {
          pending.push(target);
        }
      } else if (!isAllowedPackage(specifier)) {
        violations.push(`${entry}: ${where} imports '${specifier}', which is not allowed`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Pure export check failed:');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log(`Pure export check passed (${Object.keys(pureEntries).length} entries).`);
