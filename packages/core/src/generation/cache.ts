import type { Prompt } from 'effect/ai';

/**
 * The provider options that mark a message as a cache breakpoint. Written in Anthropic's key
 * because Anthropic is the provider that needs explicit breakpoints; other providers ignore keys
 * that are not theirs, and OpenAI caches prefixes automatically. Plain data, so Core does not
 * depend on `@effect/ai-anthropic`. No `ttl`: the API's 5-minute default applies, and a cache read
 * refreshes it. A provider that later needs explicit breakpoints adds its key here.
 */
const breakpoint = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const;

/**
 * Marks the end of Core's byte-stable prompt prefix as provider cache breakpoints, returning new
 * messages. `renderHistory` keeps the system prompt and every message before the newest input
 * unchanged across calls, so a breakpoint goes on:
 * - the system message;
 * - the last user message that has an assistant message after it (none on a first turn).
 *
 * The final user message is never marked: it carries the reminder and the current tool contexts,
 * which change every turn. Assistant messages are not marked because Effect's Anthropic provider
 * ignores their cache options. The mark moves forward each turn; the provider finds the earlier
 * call's cached prefix by looking back from the new one.
 */
export const withCacheBreakpoints = (
  messages: ReadonlyArray<Prompt.MessageEncoded>,
): Array<Prompt.MessageEncoded> => {
  const lastAssistant = messages.findLastIndex((message) => message.role === 'assistant');
  const target = messages.findLastIndex(
    (message, index) => message.role === 'user' && index < lastAssistant,
  );
  return messages.map((message, index) =>
    message.role === 'system' || index === target ? { ...message, options: breakpoint } : message,
  );
};
