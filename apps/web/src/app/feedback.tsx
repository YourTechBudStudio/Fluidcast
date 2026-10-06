import { LoaderCircle } from 'lucide-react';

// Small pieces the mode screen and the top bar use to show a request in flight or failed.

/** A request in flight, in a button's icon slot. */
export function Spinner({ size = 16 }: { readonly size?: number }) {
  return (
    <LoaderCircle
      size={size}
      strokeWidth={2}
      aria-hidden
      className="animate-spin motion-reduce:animate-none"
    />
  );
}

/** A one-line error with a red dot, in the status line's voice. */
export function ErrorLine({ text }: { readonly text: string }) {
  return (
    <p
      role="alert"
      className="flex animate-[status-in_var(--duration-surface)_var(--ease-expo)] items-start gap-2 text-[14px] leading-snug text-red"
    >
      <i
        aria-hidden
        className="mt-[7px] size-1.5 shrink-0 rounded-full bg-red shadow-[0_0_8px_var(--color-red)]"
      />
      {text}
    </p>
  );
}
