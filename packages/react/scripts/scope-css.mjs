// A PostCSS plugin that confines a compiled stylesheet to one root element, so the player never restyles its host page.
//
// Every run of consecutive style rules, at the top level or inside `@layer`, `@media`, `@supports` and `@container`
// blocks, is wrapped in `@scope (<root>) { … }`. Selectors aimed at the document (`:root`, `:host`, `html`, `body`)
// are mapped to `:scope`, the root itself. Other at-rules (`@keyframes`, `@font-face`, `@property`, `@import`,
// `@charset`, `@layer` statements) are left as they are: they are global by nature. Any document selector that cannot
// be mapped fails the build, so nothing global slips through silently.
import postcss from 'postcss';

/** At-rules whose bodies hold style rules to scope. */
const CONTAINERS = new Set(['layer', 'media', 'supports', 'container']);

/** Selectors that address the document, which become the scope root. */
const DOCUMENT = new Set([':root', ':host', 'html', 'body']);

/** A leading document compound followed by a combinator, such as `html > a` or `:root .x`. */
const LEADING = /^(:root|:host|html|body)(\s*[>+~]\s*|\s+)(\S.*)$/s;

/** Any document reference left after mapping: `:root`, `:host` in any form, or `html`/`body` as a type selector. */
const STRAY = /:root(?![\w-])|:host|(?:^|[\s>+~(,])(?:html|body)(?![\w-])/;

/** One selector with its document compound mapped to `:scope`; anything still global fails. */
const mapSelector = (selector, rule) => {
  const trimmed = selector.trim();
  if (DOCUMENT.has(trimmed)) return ':scope';
  const leading = LEADING.exec(trimmed);
  const mapped = leading ? `:scope${leading[2]}${leading[3]}` : trimmed;
  if (STRAY.test(mapped)) {
    throw rule.error(`scopePlayer: cannot scope the global selector "${trimmed}"`);
  }
  return mapped;
};

const scopeSelectors = (rule) => {
  rule.selectors = [...new Set(rule.selectors.map((selector) => mapSelector(selector, rule)))];
  rule.walkRules((nested) => {
    nested.selectors = [
      ...new Set(nested.selectors.map((selector) => mapSelector(selector, nested))),
    ];
  });
};

/** Wraps each maximal run of sibling style rules in `container` in one `@scope`, recursing into container at-rules. */
const scopeBody = (container, root) => {
  let run = [];
  const flush = () => {
    if (run.length === 0) return;
    const scope = postcss.atRule({ name: 'scope', params: `(${root})` });
    run[0].before(scope);
    for (const rule of run) {
      scopeSelectors(rule);
      scope.append(rule);
    }
    run = [];
  };
  for (const node of [...container.nodes]) {
    if (node.type === 'rule') {
      run.push(node);
      continue;
    }
    // Comments between rules do not break a run; they stay where they are.
    if (node.type === 'comment' && run.length > 0) continue;
    flush();
    if (node.type === 'atrule' && CONTAINERS.has(node.name) && node.nodes) scopeBody(node, root);
  }
  flush();
};

/** Every style rule must now sit inside the root's `@scope`; one that does not is a build failure. */
const assertScoped = (css, root) => {
  const params = `(${root})`;
  css.walkRules((rule) => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'scope' && parent.params === params) return;
      if (parent.type === 'atrule' && parent.name === 'keyframes') return;
    }
    throw rule.error(`scopePlayer: "${rule.selector}" sits outside @scope ${params}`);
  });
};

/** The PostCSS plugin scoping every style rule to `root`, a selector such as `.fluidcast-player`. */
export const scopePlayer = (root) => ({
  postcssPlugin: 'scope-player',
  OnceExit(css) {
    scopeBody(css, root);
    assertScoped(css, root);
  },
});
scopePlayer.postcss = true;
