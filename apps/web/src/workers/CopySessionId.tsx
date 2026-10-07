import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

/** The short form of a session ID: its start and end. */
const shortSessionId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

/** In place of `CopySessionId` until a new worker's agent reports its session ID. */
export function PendingSessionId() {
  return (
    <span className="inline-flex min-h-11 shrink-0 items-center gap-2 px-3 font-mono text-[12px] text-fg-muted">
      <span className="text-fg-subtle max-sm:hidden">session</span>
      <span>not available yet</span>
    </span>
  );
}

/** Copies a worker's full session ID; shows a short form. Always visible in the layer header. */
export function CopySessionId({ id }: { readonly id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={`Copy session ID ${id}`}
      title={id}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(id)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
      className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 font-mono text-[12px] text-fg-muted transition-colors duration-(--duration-ui) ease-expo hover:bg-elevated/45 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
    >
      {copied ? (
        <Check size={14} strokeWidth={1.8} aria-hidden className="text-green" />
      ) : (
        <Copy size={14} strokeWidth={1.8} aria-hidden />
      )}
      <span className="text-fg-subtle max-sm:hidden">session</span>
      <span aria-live="polite" className={copied ? 'text-green' : ''}>
        {copied ? 'Copied' : shortSessionId(id)}
      </span>
    </button>
  );
}
