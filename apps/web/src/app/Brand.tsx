/**
 * The product mark at the left of the top bar and the mode screen's header. `compact` keeps only the dot on phones, so
 * the player's top bar has room for all its controls.
 */
export function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div className="inline-flex items-center gap-2.5 font-display text-[15px] font-medium tracking-[-0.01em] text-fg-muted">
      <i
        aria-hidden
        className="size-2 rounded-full bg-linear-135 from-cyan to-violet shadow-[0_0_12px_rgb(145_215_227/0.5)]"
      />
      <span className={compact ? 'max-sm:sr-only' : ''}>Fluidcast</span>
    </div>
  );
}
