import type { GenerationError } from '@yourtechbudstudio/fluidcast-core';
import type { GenerationFailed } from '@yourtechbudstudio/fluidcast-core/actions';

/** A defect during generation: a bug, not a provider or output failure. */
export const unexpectedFailure = { _tag: 'UnexpectedError' } as const;

/**
 * The `error` of a `generation_failed` action: the failure's tag and a short message that is safe
 * to display. Built only from identifiers, never provider text or conversation content.
 */
export const describeFailure = (
  error: GenerationError | typeof unexpectedFailure,
): GenerationFailed['error'] => {
  switch (error._tag) {
    case 'UnexpectedError':
      return { tag: error._tag, message: 'The reply could not be generated.' };
    case 'ProviderError': {
      const details = [
        error.reason,
        ...(error.status === undefined ? [] : [`HTTP ${error.status}`]),
        ...(error.code === undefined ? [] : [error.code]),
      ];
      return { tag: error._tag, message: `The model provider failed (${details.join(', ')}).` };
    }
    case 'MalformedOutput':
      return {
        tag: error._tag,
        message:
          error.reason === 'no_array'
            ? 'The reply did not contain a list of lines.'
            : 'The reply ended before its list of lines was complete.',
      };
    case 'InvalidAction':
      return {
        tag: error._tag,
        message: `Line ${error.index + 1} of the reply was invalid (${error.reason}).`,
      };
  }
};
