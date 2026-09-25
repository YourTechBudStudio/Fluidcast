import type { ComponentType } from 'react';

import type { VisualId } from './catalog';
import { OrbGlass } from './OrbGlass';
import { OrbMixing } from './OrbMixing';
import { Spectrum } from './Spectrum';
import type { VisualInputs } from './types';

const COMPONENTS: Record<VisualId, ComponentType<{ inputs: VisualInputs; active: boolean }>> = {
  'electric-spectrum': Spectrum,
  'orb-mixing': OrbMixing,
  'orb-glass': OrbGlass,
};

/** Renders the chosen visual. Switching remounts it, so each visual owns a fresh canvas and context. */
export function Visual({
  id,
  inputs,
  active,
}: {
  readonly id: VisualId;
  readonly inputs: VisualInputs;
  readonly active: boolean;
}) {
  const Component = COMPONENTS[id];
  return <Component key={id} inputs={inputs} active={active} />;
}
