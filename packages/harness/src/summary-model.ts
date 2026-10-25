import { Context } from 'effect';
import type { LanguageModel } from 'effect/ai';

/**
 * An optional helper model, provided beside the voice's `LanguageModel`: it writes the session's
 * history summaries (`SessionConfig.history.compaction`) and the Agent tool's progress sentences.
 * Absent: the `LanguageModel` writes both. Nothing requires it, so no layer's requirements grow.
 * Without it, summaries use the session's own `LanguageModel` as provided; an integrator who
 * constrains or wraps that model, for example with structured output, should provide a plain
 * `SummaryModel`.
 */
export class SummaryModel extends Context.Service<SummaryModel, LanguageModel.LanguageModel>()(
  '@yourtechbudstudio/fluidcast-harness/SummaryModel',
) {}
