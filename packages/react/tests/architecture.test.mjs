import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseSync } from 'oxc-parser';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const files = readdirSync(root, { recursive: true }).filter((file) => /\.tsx?$/.test(file));
const isTest = (file) => /\.test\.tsx?$/.test(file);

/**
 * Which modules each module may import, always through the target's `index.ts`.
 * `player` composes the instance; `connection` holds the host's connection and the instance's Client; `tools` renders
 * and presents tools without knowing the conversation; `workers` presents the Forward tool's worker without knowing the
 * conversation; `ui` and `visuals` stay product-agnostic.
 */
const ALLOWED = {
  player: ['connection', 'conversation', 'playback', 'visuals', 'tools', 'ui', 'workers'],
  connection: [],
  conversation: ['connection', 'playback', 'visuals', 'tools', 'ui'],
  playback: ['connection', 'ui'],
  tools: ['ui'],
  visuals: ['ui'],
  workers: ['connection', 'ui'],
  ui: [],
};

const modules = Object.keys(ALLOWED);

/** The package's public surface: `index.ts` re-exports exactly these from `player` and `connection`. */
const PUBLIC = ['FluidcastPlayer', 'FluidcastPlayerProps', 'WorkerFeed'];

/**
 * The Fluidcast entries the player may import: the pure, browser-safe ones (`scripts/check-pure-exports.mjs`), never a
 * backend factory or the reference apps' contract.
 */
const FLUIDCAST = new Set([
  '@yourtechbudstudio/fluidcast-client',
  '@yourtechbudstudio/fluidcast-harness/protocol',
  '@yourtechbudstudio/fluidcast-core/actions',
  '@yourtechbudstudio/fluidcast-core/speech',
]);
const TOOL_SCHEMA = /^@yourtechbudstudio\/fluidcast-tool-[^/]+\/schema$/;

/** A file's import specifiers: static imports and re-exports, and dynamic `import()`s. */
function specifiersOf(file) {
  const text = readFileSync(path.join(root, file), 'utf8');
  const { errors, module } = parseSync(file, text);
  assert.deepEqual(errors, [], `${file}: failed to parse`);
  return {
    static: [
      ...module.staticImports.map((entry) => entry.moduleRequest.value),
      ...module.staticExports.flatMap((entry) =>
        entry.entries.flatMap((exported) => exported.moduleRequest?.value ?? []),
      ),
    ],
    dynamic: module.dynamicImports.map(({ moduleRequest }) =>
      text
        .slice(moduleRequest.start, moduleRequest.end)
        .trim()
        .replace(/^['"`]|['"`]$/g, ''),
    ),
  };
}

function importsOf(file) {
  const { static: statics, dynamic } = specifiersOf(file);
  return [...statics, ...dynamic];
}

function resolve(file, specifier) {
  const base = path.resolve(root, path.dirname(file), specifier);
  const found = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(
    (candidate) => existsSync(candidate) && /\.tsx?$/.test(candidate),
  );
  return found && path.relative(root, found);
}

/** The package a bare specifier names: `@scope/name` or `name`. */
const packageOf = (specifier) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

test('every source file belongs to a known module or is the public entry', () => {
  for (const file of files) {
    const [top] = file.split(path.sep);
    assert.ok(
      file === 'index.ts' || modules.includes(top),
      `${file}: not inside ${modules.join(', ')}`,
    );
  }
});

test('modules import each other only through index.ts, and only along allowed edges', () => {
  for (const file of files) {
    const [from] = file.split(path.sep);
    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(file, specifier);
      assert.ok(target, `${file}: unresolved ${specifier} (TypeScript imports no CSS)`);
      const [to] = target.split(path.sep);
      if (file === 'index.ts') {
        assert.ok(
          target === path.join('player', 'index.ts') ||
            target === path.join('connection', 'index.ts'),
          `${file}: the public entry re-exports only player and connection, not ${target}`,
        );
        continue;
      }
      if (to === from) continue;
      assert.ok(
        ALLOWED[from].includes(to),
        `${file}: ${from} must not depend on ${to} (${specifier})`,
      );
      assert.equal(
        target,
        path.join(to, 'index.ts'),
        `${file}: private import ${specifier}; ${to} publishes only ${to}/index.ts`,
      );
    }
  }
});

test('the public entry exports exactly the player, its props and WorkerFeed', () => {
  const text = readFileSync(path.join(root, 'index.ts'), 'utf8');
  const { module } = parseSync('index.ts', text);
  const exported = module.staticExports.flatMap((entry) =>
    entry.entries.map((item) => item.exportName.name),
  );
  assert.deepEqual([...exported].sort(), [...PUBLIC].sort());
});

test('Fluidcast is imported only through pure entries, and never the reference apps or effect/http', () => {
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      assert.ok(
        !specifier.startsWith('@fluidcast/'),
        `${file}: imports ${specifier}; the player never depends on the reference apps`,
      );
      assert.ok(
        specifier !== 'effect/http',
        `${file}: imports effect/http; the host's connection carries all backend traffic`,
      );
      if (!specifier.startsWith('@yourtechbudstudio/fluidcast-')) continue;
      assert.ok(
        FLUIDCAST.has(specifier) || TOOL_SCHEMA.test(specifier),
        `${file}: imports ${specifier}; the player may import only pure Fluidcast entries and tool /schema entries`,
      );
    }
  }
});

test('production code imports only declared dependencies', () => {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  for (const file of files) {
    if (isTest(file)) continue;
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) continue;
      assert.ok(
        declared.has(packageOf(specifier)),
        `${file}: imports ${specifier}, which is not a dependency or peer dependency`,
      );
    }
  }
});

test('mermaid loads lazily: only through a dynamic import inside tools', () => {
  const mermaid = (specifier) => specifier === 'mermaid' || specifier.startsWith('mermaid/');
  for (const file of files) {
    const { static: statics, dynamic } = specifiersOf(file);
    assert.ok(
      !statics.some(mermaid),
      `${file}: imports mermaid statically; load it with import() so it stays out of the main bundle`,
    );
    if (dynamic.some(mermaid)) {
      assert.equal(file.split(path.sep)[0], 'tools', `${file}: only tools may load mermaid`);
    }
  }
});
