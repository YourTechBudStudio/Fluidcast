import type { ReactNode } from 'react';

export function Kbd({ children }: { readonly children: ReactNode }) {
  return (
    <kbd className="rounded-[4px] border border-line/30 bg-scrim/45 px-1 font-mono text-[10px] leading-[1.3] font-medium text-fg-subtle">
      {children}
    </kbd>
  );
}
