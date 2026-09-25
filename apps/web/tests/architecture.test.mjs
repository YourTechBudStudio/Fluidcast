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
 * `ui` and `visuals` stay product-agnostic; `mock` is temporary fixture code that only the root composition installs,
 * so phase 5 can delete it by removing one import from `app`.
 */
const ALLOWED = {
  app: ['conversation', 'playback', 'visuals', 'ui', 'mock'],
  conversation: ['playback', 'visuals', 'ui'],
  playback: ['ui'],
  visuals: ['ui'],
  ui: [],
  mock: ['conversation', 'playback', 'visuals'],
};

const modules = Object.keys(ALLOWED);

function importsOf(file) {
  const text = readFileSync(path.join(root, file), 'utf8');
  const { errors, module } = parseSync(file, text);
  assert.deepEqual(errors, [], `${file}: failed to parse`);
  return [
    ...module.staticImports.map((entry) => entry.moduleRequest.value),
    ...module.staticExports.flatMap((entry) =>
      entry.entries.flatMap((exported) => exported.moduleRequest?.value ?? []),
    ),
    ...module.dynamicImports.map(({ moduleRequest }) =>
      text
        .slice(moduleRequest.start, moduleRequest.end)
        .trim()
        .replace(/^['"`]|['"`]$/g, ''),
    ),
  ];
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
