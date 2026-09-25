import { GlVisual } from './GlVisual';
import { createOrbGlassRenderer, orbGlassFallback } from './orb-glass/renderer';
import type { VisualInputs } from './types';

export function OrbGlass({
  inputs,
  active,
}: {
  readonly inputs: VisualInputs;
  readonly active: boolean;
}) {
  return (
    <GlVisual
      tag="orb-glass"
      factory={createOrbGlassRenderer}
      shape="orb"
      inputs={inputs}
      active={active}
      fallbackTones={orbGlassFallback(inputs.state)}
      fallback={<div className="visual-fallback orb-glass-fallback" />}
      className="size-full"
    />
  );
}
