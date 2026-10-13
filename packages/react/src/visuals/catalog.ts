export const VISUAL_IDS = ['electric-spectrum', 'orb-mixing', 'orb-glass'] as const;
export type VisualId = (typeof VISUAL_IDS)[number];

export const DEFAULT_VISUAL: VisualId = 'electric-spectrum';

export const VISUAL_NAMES: Record<VisualId, string> = {
  'electric-spectrum': 'Electric spectrum',
  'orb-mixing': 'Orb mixing',
  'orb-glass': 'Orb glass',
};

export const isVisualId = (value: unknown): value is VisualId =>
  VISUAL_IDS.includes(value as VisualId);
