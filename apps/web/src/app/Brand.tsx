/** The product mark in the mode screen's header. */
export function Brand() {
  return (
    <div className="inline-flex items-center gap-2.5 font-display text-[15px] font-medium tracking-[-0.01em] text-fg-muted">
      <i
        aria-hidden
        className="size-2 rounded-full bg-linear-135 from-cyan to-violet shadow-[0_0_12px_rgb(145_215_227/0.5)]"
      />
      <span>Fluidcast</span>
    </div>
  );
}
