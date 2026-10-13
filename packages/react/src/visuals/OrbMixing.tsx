import { GlVisual } from './GlVisual';
import { createOrbMixingRenderer, orbMixingFallback } from './orb-mixing/renderer';
import type { VisualInputs } from './types';

export function OrbMixing({
  inputs,
  active,
}: {
  readonly inputs: VisualInputs;
  readonly active: boolean;
}) {
  return (
    <GlVisual
      tag="orb-mixing"
      factory={createOrbMixingRenderer}
      shape="orb"
      inputs={inputs}
      active={active}
      fallbackTones={orbMixingFallback(inputs.state)}
      fallback={<div className="visual-fallback orb-mixing-fallback" />}
      className="size-full"
    />
  );
}
