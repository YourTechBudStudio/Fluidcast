// MOCK ONLY. Small components shared by the Workers layer and the main transcript.

import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { WorkerStatus } from './fixtures';
import { renderWorkerMarkdown, shortSessionId, STATUS_COLOR } from './helpers';

export function Prose({
  text,
  className = '',
}: {
  readonly text: string;
  readonly className?: string;
}) {
  const html = useMemo(() => renderWorkerMarkdown(text), [text]);
  return (
    <div
      className={`show-prose worker-prose ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function StatusDot({
  status,
  size = 7,
}: {
  readonly status: WorkerStatus;
  readonly size?: number;
}) {
  const color = STATUS_COLOR[status];
  return (
    <i
      aria-hidden
      className={`shrink-0 rounded-full ${status === 'working' ? 'motion-safe:animate-breathe' : ''}`}
      style={{ width: size, height: size, backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
    />
  );
}

/** Writes the full session ID; shows a short form. Always visible in the layer header. */
export function CopySessionId({ id }: { readonly id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={`Copy session ID ${id}`}
      title={id}
      onClick={() => {
        void navigator.clipboard?.writeText(id).catch(() => undefined);
        setCopied(true);
      }}
      className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 font-mono text-[12px] text-fg-muted transition-colors duration-(--duration-ui) ease-expo hover:bg-elevated/45 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
    >
      {copied ? (
        <Check size={14} strokeWidth={1.8} aria-hidden className="text-green" />
      ) : (
        <Copy size={14} strokeWidth={1.8} aria-hidden />
      )}
      <span className="max-sm:hidden text-fg-subtle">session</span>
      <span aria-live="polite" className={copied ? 'text-green' : ''}>
        {copied ? 'Copied' : shortSessionId(id)}
      </span>
    </button>
  );
}
