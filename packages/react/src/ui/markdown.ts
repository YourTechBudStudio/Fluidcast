import hljs from 'highlight.js/lib/common';
import MarkdownIt from 'markdown-it';

/**
 * Renders one fenced block in place of the code block: its markup, or `undefined` to keep the code block. `code`
 * renders that code block, for markup that wraps it.
 */
export type FenceRenderer = (
  language: string,
  content: string,
  code: () => string,
) => string | undefined;

/**
 * A Markdown renderer for the app's DOM. `html` says whether raw HTML in the source passes through. Link destinations
 * keep markdown-it's default `validateLink`, which blocks `javascript:`, `vbscript:`, `file:` and most `data:` URLs,
 * and every link opens in a new tab without access to the page. Fenced code that names a language highlight.js knows
 * (its common set) is highlighted; any other code stays plain, escaped text. A call's `renderFence` can render fenced
 * blocks as something else, such as diagrams.
 */
export const createMarkdown = ({
  html,
}: {
  readonly html: boolean;
}): ((source: string, renderFence?: FenceRenderer) => string) => {
  const markdown = new MarkdownIt({
    html,
    linkify: true,
    typographer: true,
    highlight: (code, language) =>
      language !== '' && hljs.getLanguage(language) !== undefined
        ? hljs.highlight(code, { language, ignoreIllegals: true }).value
        : '',
  });
  const renderToken = markdown.renderer.renderToken.bind(markdown.renderer);
  markdown.renderer.rules.link_open = (tokens, index, options) => {
    const token = tokens[index]!;
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
    return renderToken(tokens, index, options);
  };
  const renderCode = markdown.renderer.rules.fence!;
  markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index]!;
    const language = token.info.trim().split(/\s+/, 1)[0] ?? '';
    const code = () => renderCode(tokens, index, options, env, self);
    return (env as Env).renderFence?.(language, token.content, code) ?? code();
  };
  return (source, renderFence) => markdown.render(source, { renderFence } satisfies Env);
};

interface Env {
  readonly renderFence?: FenceRenderer | undefined;
}
