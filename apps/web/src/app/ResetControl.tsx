import { useAtom } from '@effect/atom-react';
import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AsyncResult, Atom } from 'effect/reactivity';
import { RotateCcw } from 'lucide-react';

import { resetSession } from '../client';
import { Spinner } from './feedback';

/**
 * Ends one backend session. One entry per session ID, so a Reset from an earlier session never shows in the next.
 * The page leaves the session only when the status stream reports it.
 */
const resetAtom = Atom.family((sessionId: string) =>
  Atom.fn((_: void) =>
    resetSession(sessionId).pipe(
      Effect.tapError((error) =>
        Effect.logWarning('reset failed').pipe(
          Effect.annotateLogs({ reason: error.reason, status: error.status }),
        ),
      ),
      Effect.provide(FetchHttpClient.layer),
    ),
  ),
);

const FAILED = 'Couldn’t reset: the backend didn’t confirm it. Press Reset to try again.';
const FAILED_SHORT = 'Couldn’t reset. Try again.';

/**
 * Reset, in the app strip above the player: ends this session and returns to the mode screen, with no confirmation.
 * - pending while the request runs, and after it succeeded until the page leaves the session: it ignores presses;
 * - failed when the backend did not confirm it: the failure shows beside it until the next press, which retries.
 */
export function ResetControl({ sessionId }: { readonly sessionId: string }) {
  const [result, reset] = useAtom(resetAtom(sessionId));
  const pending = result.waiting || AsyncResult.isSuccess(result);
  const failed = !pending && AsyncResult.isFailure(result);
  return (
    <div className="flex min-w-0 items-center justify-end gap-2.5">
      {/* Mounted in every state, so screen readers announce the failure when it appears. One sentence is accessible at
          every width; phones see a shorter one. */}
      <p
        role="status"
        className="flex min-w-0 items-center gap-2 text-right text-[13.5px] leading-snug text-red"
      >
        {failed && (
          <>
            <i
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-red shadow-[0_0_8px_var(--color-red)]"
            />
            <span className="motion-safe:animate-[status-in_var(--duration-surface)_var(--ease-expo)] max-sm:sr-only">
              {FAILED}
            </span>
            <span
              aria-hidden
              className="motion-safe:animate-[status-in_var(--duration-surface)_var(--ease-expo)] sm:hidden"
            >
              {FAILED_SHORT}
            </span>
          </>
        )}
      </p>
      <button
        type="button"
        aria-label="Reset: end this session and go back to the start"
        aria-disabled={pending || undefined}
        onClick={pending ? undefined : () => reset()}
        // 32 px tall so it reads as app chrome, not a player control; the pseudo-element keeps a 44 px hit area.
        className={`relative inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-[13.5px] transition-[background-color,color,opacity] duration-(--duration-surface) ease-expo before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-elevated/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue aria-disabled:cursor-default aria-disabled:opacity-45 ${failed ? 'text-red' : 'text-fg-muted hover:text-fg'}`}
      >
        {pending ? <Spinner size={14} /> : <RotateCcw size={14} strokeWidth={1.8} aria-hidden />}
        {pending ? 'Resetting…' : 'Reset'}
      </button>
    </div>
  );
}
