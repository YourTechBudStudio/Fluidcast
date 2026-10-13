import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseSync } from 'oxc-parser';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(root, { recursive: true }).filter((file) => /\.tsx?$/.test(file));

/**
 * Which modules each module may import, always through the target's `index.ts`. `app` owns routing, setup, session
 * start and Reset; `client` is the HTTP adapter over the reference backend. The player itself is the
 * `@yourtechbudstudio/fluidcast-react` package, used only through its public surface.
 */
const ALLOWED = {
  app: ['client'],
  client: [],
};

/** The player package's public entries: its root and its stylesheet. */
const PLAYER = /^@yourtechbudstudio\/fluidcast-react(\/|$)/;
const PLAYER_ENTRIES = [
  '@yourtechbudstudio/fluidcast-react',
  '@yourtechbudstudio/fluidcast-react/styles.css',
];

/** Files outside `client` that use the reference backend's contract (its agents, statuses and start failures). */
const CONTRACT_USERS = ['state', 'agents', 'route', 'startFailure'].flatMap((name) => [
  path.join('app', `${name}.ts`),
  path.join('app', `${name}.test.ts`),
]);

const modules = Object.keys(ALLOWED);

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
    (candidate) => existsSync(candidate) && /\.(tsx?|css)$/.test(candidate),
  );
  return found && path.relative(root, found);
}

test('every source file belongs to a known module or is the entry point', () => {
  for (const file of files) {
    const [top] = file.split(path.sep);
    assert.ok(
      file === 'main.tsx' || modules.includes(top),
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
      assert.ok(target, `${file}: unresolved ${specifier}`);
      const [to] = target.split(path.sep);
      if (file === 'main.tsx') {
        assert.ok(
          target === 'styles.css' || target === path.join('app', 'index.ts'),
          `${file}: the entry point composes only app and its stylesheet, not ${target}`,
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

test('the tool packages are imported only through their pure ./schema entry', () => {
  // A tool package's root is its backend factory; only `./schema` is safe for the browser.
  const toolPackage = /^@yourtechbudstudio\/fluidcast-tool-[^/]+/;
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      if (!toolPackage.test(specifier)) continue;
      assert.match(
        specifier,
        /^@yourtechbudstudio\/fluidcast-tool-[^/]+\/schema$/,
        `${file}: imports ${specifier}; web code may import a tool package only through /schema`,
      );
    }
  }
});

test('the entry point imports only app, its stylesheet and the player stylesheet', () => {
  for (const specifier of importsOf('main.tsx')) {
    if (specifier.startsWith('.')) continue;
    if (!PLAYER.test(specifier)) continue;
    assert.equal(
      specifier,
      '@yourtechbudstudio/fluidcast-react/styles.css',
      `main.tsx: imports ${specifier}; the entry point takes only the player's stylesheet`,
    );
  }
});

test('the player is used only through its public entries', () => {
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      if (!PLAYER.test(specifier)) continue;
      assert.ok(
        PLAYER_ENTRIES.includes(specifier),
        `${file}: imports ${specifier}; use the package root or /styles.css only`,
      );
    }
  }
});

test('the reference contract stays in the HTTP adapter and the files that use it today', () => {
  for (const file of files) {
    if (!importsOf(file).includes('@fluidcast/app-contract')) continue;
    assert.ok(
      file.split(path.sep)[0] === 'client' || CONTRACT_USERS.includes(file),
      `${file}: imports @fluidcast/app-contract; only client/ and ${CONTRACT_USERS.join(', ')} may`,
    );
  }
});
