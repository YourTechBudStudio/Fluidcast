import MarkdownIt from 'markdown-it';

/**
 * One renderer for every Markdown Show. Raw HTML and remote images are allowed (A2, an accepted risk). Link
 * destinations keep markdown-it's default `validateLink`, which blocks `javascript:`, `vbscript:`, `file:` and most
 * `data:` URLs, and every link opens in a new tab without access to the player.
 */
const markdown = new MarkdownIt({ html: true, linkify: true, typographer: true });

const renderToken = markdown.renderer.renderToken.bind(markdown.renderer);
markdown.renderer.rules.link_open = (tokens, index, options) => {
  const token = tokens[index]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return renderToken(tokens, index, options);
};

/** Markdown source as HTML for the app's DOM. */
export const renderMarkdown = (source: string): string => markdown.render(source);
