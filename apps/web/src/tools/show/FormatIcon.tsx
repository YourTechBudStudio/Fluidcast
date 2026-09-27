import { CodeXml, FileText, Workflow } from 'lucide-react';

import type { ShowFormat } from '@yourtechbudstudio/fluidcast-tool-show/schema';

const FORMAT_ICON: Record<ShowFormat, typeof FileText> = {
  markdown: FileText,
  mermaid: Workflow,
  html: CodeXml,
};

export function FormatIcon({
  format,
  size = 16,
}: {
  readonly format: ShowFormat;
  readonly size?: number;
}) {
  const Icon = FORMAT_ICON[format];
  return <Icon size={size} strokeWidth={1.8} aria-hidden />;
}
