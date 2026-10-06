import MarkdownIt from 'markdown-it';

/**
 * A Markdown renderer for the app's DOM. `html` says whether raw HTML in the source passes through. Link destinations
 * keep markdown-it's default `validateLink`, which blocks `javascript:`, `vbscript:`, `file:` and most `data:` URLs,
 * and every link opens in a new tab without access to the page.
 */
export const createMarkdown = ({
  html,
}: {
  readonly html: boolean;
}): ((source: string) => string) => {
  const markdown = new MarkdownIt({ html, linkify: true, typographer: true });
  const renderToken = markdown.renderer.renderToken.bind(markdown.renderer);
  markdown.renderer.rules.link_open = (tokens, index, options) => {
    const token = tokens[index]!;
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
    return renderToken(tokens, index, options);
  };
  return (source) => markdown.render(source);
};
