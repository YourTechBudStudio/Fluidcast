/** Capping of transcript content, shared by every worker type's transcript mapping. Pure. */

/** The cap on a tool call's input JSON and a tool result's text, in characters. */
export const maxContentLength = 4000;

/** `text` cut to `maxContentLength`, with `truncated` saying whether the cap applied. */
export const capped = (text: string) =>
  text.length > maxContentLength
    ? { text: text.slice(0, maxContentLength), truncated: true }
    : { text, truncated: false };
