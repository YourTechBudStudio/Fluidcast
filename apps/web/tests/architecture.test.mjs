import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseSync } from 'oxc-parser';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(root, { recursive: true }).filter((file) => /\.tsx?$/.test(file));

/**
 * Which modules each module may import, always through the target's `index.ts`.
 * `client` owns the page's Client SDK instance and transport; `tools` renders and presents tools without knowing the
 * conversation; `ui` and `visuals` stay product-agnostic.
 */
const ALLOWED = {
  app: ['client', 'conversation', 'playback', 'visuals', 'tools', 'ui'],
  client: [],
  conversation: ['client', 'playback', 'visuals', 'tools', 'ui'],
  playback: ['client', 'ui'],
  tools: ['ui'],
  visuals: ['ui'],
  ui: [],
};

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
          `${file}: the entry point composes only app, not ${target}`,
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
