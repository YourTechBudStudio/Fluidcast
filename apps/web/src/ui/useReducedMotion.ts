import { useMedia } from './useMedia';

/** Follows the OS "reduce motion" setting live. */
export const useReducedMotion = (): boolean => useMedia('(prefers-reduced-motion: reduce)');
