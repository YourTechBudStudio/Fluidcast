import { describe, expect, it } from 'vitest';

import { createMarkdown } from './markdown';

const render = createMarkdown({ html: false });

describe('createMarkdown', () => {
  it('highlights fenced code in a known language', () => {
    const html = render('```ts\nconst answer: number = 42;\n```');
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  it('leaves unknown or unnamed languages as escaped text', () => {
    expect(render('```nope\n<b>x</b>\n```')).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(render('```\nconst x = 1;\n```')).not.toContain('hljs-');
  });

  it('renders a fenced block through renderFence, by its language', () => {
    const html = render(
      'Before\n\n```mermaid extra\ngraph TD\n```\n\n```ts\nconst x = 1;\n```',
      (language, content) =>
        language === 'mermaid' ? `<figure>${content.trim()}</figure>` : undefined,
    );
    expect(html).toContain('<figure>graph TD</figure>');
    expect(html).not.toContain('language-mermaid');
    expect(html).toContain('<code class="language-ts">');
  });

  it('lets renderFence wrap the code block it would replace', () => {
    const html = render(
      '```mermaid\ngraph <TD>\n```',
      (_language, _content, code) => `<div>${code()}</div>`,
    );
    expect(html).toMatch(
      /^<div><pre><code class="language-mermaid">graph &lt;TD&gt;\n<\/code><\/pre>\n<\/div>/,
    );
  });
});
