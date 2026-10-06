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
});
