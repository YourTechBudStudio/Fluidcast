import { useId } from 'react';

/**
 * An id unique to this mounted component, for SVG references (`url(#…)`): two players, or two copies in one player,
 * never resolve to each other's definitions. Reduced to characters that are safe in ids and `url()` references.
 */
export const useDomId = (prefix: string): string =>
  `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
