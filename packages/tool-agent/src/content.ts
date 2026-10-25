/** Transcript content helpers shared by every worker type's transcript mapping. Pure. */

import type { TranscriptEntry } from './schema.ts';

/** The cap on a tool call's input JSON and a tool result's text, in characters. */
export const maxContentLength = 4000;

/** `text` cut to `maxContentLength`, with `truncated` saying whether the cap applied. */
export const capped = (text: string) =>
  text.length > maxContentLength
    ? { text: text.slice(0, maxContentLength), truncated: true }
    : { text, truncated: false };

/**
 * Stored history without repeated thinking markers: drops a `thinking` entry when the previous
 * entry with the same `parentToolUseId` (entries of other parents are skipped) is also `thinking`.
 * Live, one marker starts each thinking stretch and only an entry of the same parent ends it, so
 * this makes a restored session show what a live one would have.
 */
export const oneThinkingPerStretch = (
  entries: ReadonlyArray<TranscriptEntry>,
): ReadonlyArray<TranscriptEntry> => {
  const last = new Map<string | null, TranscriptEntry['_tag']>();
  return entries.filter((entry) => {
    const repeated = entry._tag === 'thinking' && last.get(entry.parentToolUseId) === 'thinking';
    last.set(entry.parentToolUseId, entry._tag);
    return !repeated;
  });
};
