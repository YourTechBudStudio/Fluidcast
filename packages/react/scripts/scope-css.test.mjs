import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import postcss from 'postcss';

import { scopePlayer } from './scope-css.mjs';

const ROOT = '.fluidcast-player';

/** The stylesheet after scoping, compacted to one line with single spaces around braces, so expectations stay readable. */
const scoped = (css) =>
  postcss([scopePlayer(ROOT)])
    .process(css, { from: undefined })
    .css.replace(/\s*([{}])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();

describe('scopePlayer', () => {
  it('maps document selectors to the scope root, alone or leading a combinator', () => {
    assert.equal(
      scoped(':root, :host { --x: 1 }'),
      '@scope (.fluidcast-player) { :scope { --x: 1 } }',
    );
    assert.equal(
      scoped('html, body, .a { color: red }'),
      '@scope (.fluidcast-player) { :scope, .a { color: red } }',
    );
    assert.equal(
      scoped('html > .a, :root .b { color: red }'),
      '@scope (.fluidcast-player) { :scope > .a, :scope .b { color: red } }',
    );
  });

  it('wraps each run of sibling rules once, inside layers, media, supports and container queries', () => {
    assert.equal(
      scoped('.a { color: red } .b { color: blue } @media (hover: hover) { .c { color: green } }'),
      '@scope (.fluidcast-player) { .a { color: red } .b { color: blue } } ' +
        '@media (hover: hover) { @scope (.fluidcast-player) { .c { color: green } } }',
    );
    assert.equal(
      scoped(
        '@layer base { @supports (display: grid) { @container x (width < 1px) { .a { color: red } } } }',
      ),
      '@layer base { @supports (display: grid) { @container x (width < 1px) { ' +
        '@scope (.fluidcast-player) { .a { color: red } } } } }',
    );
  });

  it('leaves global at-rules where they are and splits runs around them', () => {
    const css =
      "@import 'x'; @layer theme, base; .a { color: red } @keyframes fc-spin { to { rotate: 1turn } } " +
      "@font-face { font-family: X } @property --y { syntax: '*'; inherits: false } .b { color: blue }";
    assert.equal(
      scoped(css),
      "@import 'x'; @layer theme, base; @scope (.fluidcast-player) { .a { color: red } } " +
        '@keyframes fc-spin { to { rotate: 1turn } } @font-face { font-family: X } ' +
        "@property --y { syntax: '*'; inherits: false } @scope (.fluidcast-player) { .b { color: blue } }",
    );
  });

  it('keeps class names that merely contain a document word', () => {
    assert.equal(
      scoped('.body, .html-view, [data-x="body"] { color: red }'),
      '@scope (.fluidcast-player) { .body, .html-view, [data-x="body"] { color: red } }',
    );
  });

  it('fails the build on a document selector it cannot map', () => {
    for (const css of [
      '.a :root { color: red }',
      ':host(.dark) .a { color: red }',
      '.a body { color: red }',
      'html.dark .a { color: red }',
      ':is(html) .a { color: red }',
      '.a { & body { color: red } }',
    ]) {
      assert.throws(() => scoped(css), /scopePlayer: cannot scope the global selector/, css);
    }
  });

  it('fails the build on a style rule left outside the scope', () => {
    assert.throws(
      () => scoped('@starting-style { .a { opacity: 0 } }'),
      /scopePlayer: ".a" sits outside @scope/,
    );
  });
});
