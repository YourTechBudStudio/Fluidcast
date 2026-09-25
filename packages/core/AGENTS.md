# Core SDK (`@yourtechbudstudio/fluidcast-core`)

Stateless action generation and speech synthesis (ADR 0001). Core never stores action IDs or conversation history; callers pass the history in.

## Structure

Three deep modules under `src/`, each exposing an `index.ts` barrel:

- `actions/`: the action vocabulary (ADR 0006). Effect Schemas for the flat `Action` union (`user_message`, `speak`, `interrupted`, `generation_failed`), the model-authored subset `ModelAction`, the branded `ActionId` with its UUIDv7 generator, and `SpeakerProfile`. The annotations on `ModelSpeak` are the model-facing guidance.
- `generation/`: `generate`, which renders the system prompt (including a TypeScript type rendered from `ModelAction`) and the history as native chat messages, calls `LanguageModel.streamText`, and parses the streamed JSON array into `speak` actions as each element closes. It stops reading at the closing `]`. Failures are the tagged `GenerationError` union: `ProviderError`, `MalformedOutput`, `InvalidAction`.
- `speech/`: the `SpeechSynthesizer` service, `synthesize`, format-to-MIME-type mapping, and `layerOpenAi` for OpenAI-compatible `/audio/speech`. Failures are `SpeechError`.

## Exports

- `.`: everything above.
- `./actions`: the `actions/` module alone. It is a **pure** export: it may import only `effect` stable modules, files inside `src/actions/`, and other pure entries. `scripts/check-pure-exports.mjs` at the repo root enforces this in `pnpm check`.

## Stack and rules

- Effect v4: `effect/Schema` for the vocabulary and errors, `effect/unstable/ai` (`LanguageModel`, `Prompt`) for generation, and `@effect/ai-openai`'s generated client for speech. The provider and API for generation come from the caller's `LanguageModel` layer; the speech layer requires the caller's `HttpClient`.
- No JSON Schema, `response_format` or constrained decoding. The output contract is the rendered TypeScript type in the prompt.
- Keep the system prompt deterministic for a given config, so providers can cache the prefix.
- Errors carry identifiers only (tags, reasons, indexes, HTTP status, provider codes), never conversation content, prompts, provider messages or credentials.
- Tests use `node:test` and cover the streaming parser, with scripted streams and layers instead of real providers.
