import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import type { ShowBody } from './ShowBody';

/**
 * Where an error on its way back to the model stands: `sent` once the model has it (the outcome is in the log),
 * `pending` before then, and `null` when no correction will come, so none is promised.
 */
export type Correction = 'sent' | 'pending' | null;

/**
 * Where a failed Show's error stands, and whether a replacement can still come: `awaited` while the model's turn is
 * still going. Once the turn is over without a newer Show, no replacement is promised.
 */
export type ShowCorrection = {
  readonly error: Exclude<Correction, null>;
  readonly awaited: boolean;
} | null;

/** One Show as the panel and the sheet display it. */
export interface ShownShow {
  readonly handle: string;
  readonly input: ShowInput;
  readonly body: ShowBody;
  /** Its failure on the way back to the model: only ever for the latest Show, and never after a halt. */
  readonly correction: ShowCorrection;
}
