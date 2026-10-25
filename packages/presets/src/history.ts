/**
 * A default for the Harness's `history.compaction.aboveInputTokens`. It keeps total input within a
 * 64K-token context window, which a local model on a decent GPU can be expected to have.
 */
export const defaultCompactionThreshold = 56_000;
