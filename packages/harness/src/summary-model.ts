import { Context, Effect, Option } from 'effect';
import { LanguageModel } from 'effect/ai';

/**
 * An optional helper model for plain-text work beside the voice's `LanguageModel`, such as history
 * summaries (`SessionConfig.history.compaction`) and tools' helper text. Nothing requires it, so no
 * layer's requirements grow.
 */
export class SummaryModel extends Context.Service<SummaryModel, LanguageModel.LanguageModel>()(
  '@yourtechbudstudio/fluidcast-harness/SummaryModel',
) {}

/**
 * The `SummaryModel` when provided, else the `LanguageModel` as provided. An integrator who
 * constrains or wraps that model, for example with structured output, should provide a plain
 * `SummaryModel`.
 */
export const summaryModel: Effect.Effect<
  LanguageModel.LanguageModel,
  never,
  LanguageModel.LanguageModel
> = Effect.gen(function* () {
  const provided = yield* Effect.serviceOption(SummaryModel);
  return Option.isSome(provided) ? provided.value : yield* LanguageModel.LanguageModel;
});
