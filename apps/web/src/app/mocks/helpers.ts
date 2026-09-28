// MOCK ONLY. Non-component presentation helpers for the Workers layer and the main transcript.

import {
  Bot,
  FilePen,
  FileText,
  Globe,
  type LucideIcon,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import MarkdownIt from 'markdown-it';

import type { WorkerStatus } from './fixtures';

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: SquareTerminal,
  Read: FileText,
  Edit: FilePen,
  Write: FilePen,
  Grep: Search,
  Glob: Search,
  WebSearch: Globe,
  WebFetch: Globe,
  Agent: Bot,
};

export const toolIcon = (name: string): LucideIcon => TOOL_ICONS[name] ?? Wrench;

export const STATUS_COLOR: Record<WorkerStatus, string> = {
  working: 'var(--color-violet)',
  done: 'var(--color-green)',
  failed: 'var(--color-red)',
};

export const STATUS_LABEL: Record<WorkerStatus, string> = {
  working: 'Working',
  done: 'Done',
  failed: 'Failed',
};

export const shortSessionId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

/** Worker Markdown: raw HTML off (program-design §9.3); links open in a new tab without access to the player. */
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
const renderToken = markdown.renderer.renderToken.bind(markdown.renderer);
markdown.renderer.rules.link_open = (tokens, index, options) => {
  const token = tokens[index]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return renderToken(tokens, index, options);
};

export const renderWorkerMarkdown = (source: string): string => markdown.render(source);
