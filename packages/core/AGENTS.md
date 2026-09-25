# Core SDK (`@yourtechbudstudio/fluidcast-core`)

Stateless action generation and speech synthesis. Core never stores action IDs or conversation history; callers pass the history in. Built on Effect v4.

## Structure

- `src/actions/`: the action vocabulary. Exported alone as `./actions`, a pure entry: only `effect` stable modules, files inside `src/actions/`, and other pure entries (enforced by `scripts/check-pure-exports.mjs`).
- `src/generation/`: prompt rendering, the model call and the streaming JSON parser.
- `src/speech/`: the `SpeechSynthesizer` service and the OpenAI-compatible layer.

## Rules

- No JSON Schema, `response_format` or constrained decoding. The output contract is the TypeScript type rendered into the prompt from `ModelAction`.
- Keep the system prompt deterministic for a given config, so providers can cache the prefix.
- Errors carry identifiers only, never conversation content, prompts, provider messages or credentials.
