// Invariants of the built stylesheet (`dist/styles.css`, built before tests run): everything the player styles is
// confined to its root, and the only global additions are font imports, `@font-face`, `@property` and `fc-` keyframes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = postcss.parse(readFileSync(resolve(root, 'dist/styles.css'), 'utf8'));

const SCOPE = '(.fluidcast-player)';
const FONTS = [
  "'@fontsource-variable/sora'",
  "'@fontsource-variable/source-sans-3'",
  "'@fontsource-variable/fira-code'",
];

const ancestors = function* (node) {
  for (let parent = node.parent; parent; parent = parent.parent) yield parent;
};
const isAt = (node, name) => node.type === 'atrule' && node.name === name;

describe('dist/styles.css', () => {
  it('scopes every style rule to the player root', () => {
    const unscoped = [];
    css.walkRules((rule) => {
      const parents = [...ancestors(rule)];
      if (parents.some((parent) => isAt(parent, 'keyframes'))) return;
      if (!parents.some((parent) => isAt(parent, 'scope') && parent.params === SCOPE))
        unscoped.push(rule.selector);
    });
    assert.deepEqual(unscoped, []);
  });

  it('addresses no document element', () => {
    const global = [];
    css.walkRules((rule) => {
      if (/:root|:host|(?:^|[\s>+~(,])(?:html|body)(?![\w-])/.test(rule.selector))
        global.push(rule.selector);
    });
    assert.deepEqual(global, []);
  });

  it('prefixes every keyframes name with fc-', () => {
    const names = [];
    css.walkAtRules('keyframes', (rule) => void names.push(rule.params));
    assert.ok(names.length > 0);
    assert.deepEqual(
      names.filter((name) => !name.startsWith('fc-')),
      [],
    );
  });

  it('imports only the three fontsource families, first', () => {
    const imports = [];
    css.walkAtRules('import', (rule) => void imports.push(rule.params));
    assert.deepEqual(imports, FONTS);
    assert.deepEqual(
      css.nodes.slice(0, 3).map((node) => (isAt(node, 'import') ? node.params : null)),
      FONTS,
    );
  });
});
