import { createMarkdown } from '../../ui';

/** One renderer for every Markdown Show. Raw HTML and remote images are allowed (A2, an accepted risk). */
export const renderMarkdown = createMarkdown({ html: true });
