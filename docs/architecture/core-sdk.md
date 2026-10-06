# Core SDK

## Stateless generation

Core accepts caller-owned conversation history, instructions, worked examples, tool definitions, speaker profiles and reminders. It generates through Effect's provider-neutral `LanguageModel` service and asks the model for a JSON array of **speak** and **tool-call** actions rather than native tool calls, allowing speech and multiple tool requests in one response. The provider and API (for example, OpenAI Chat Completions or Responses) are integration configuration supplied as a layer, not something Core targets.

Core parses that output incrementally into an Effect-native action stream and assigns action IDs itself. It stores neither those IDs nor conversation history. Generation and parsing failures surface to the harness, which owns recovery. Output that is not valid JSON fails the generation; a tool call that does not match its tool's schema becomes a tool error the model can correct.

Each tool appears to the model as its own action type, described through TypeScript-style schema descriptions. For providers that can constrain decoding to a schema, Core also derives the output's JSON Schema from the same action union (`outputJsonSchema`); the reference backend opts in per `openai-compatible` provider with `llm.provider.structuredOutput`. Core's prompt carries mechanics only: the output format, how actions, results, errors, progress and notices read, and the tools' mechanical guidelines. The voice's behavior (its role, spoken style, worked examples and reminder texts) comes from the configuration's instructions, examples, speakers and reminders, normally a preset ([ADR 0005](../adrs/0005-voice-behavior-as-presets.md)); without one, the prompt has no behavior of its own. Tool results, tool-supplied per-iteration context, and queued key-value context accompany subsequent input in XML-style envelopes, keeping the system prompt stable for caching. A **reminder** follows only the newest input (the latest tool results or listener message) as `<reminder>`. Tools supply none: the configuration's reminders function, normally a preset's, chooses one per event (a tool result, or a listener message, noting whether it followed an interruption). Older inputs never show theirs, so earlier messages stay unchanged for prefix caching. There is no model-generated end action, and runtime error actions belong to the harness.

## Speech and TTS

Speaker profiles contain an ID, name, and personality. Each speak action contains a speaker ID and content; multiple speakers alternate through separate actions. There is no tone field initially. Generation should favor bounded speech segments, no longer than roughly one or two minutes.

Core also provides a speech synthesis service, initially implemented for OpenAI TTS. Each request carries its text and a voice (a provider voice ID plus optional delivery guidance); provider settings are fixed when its layer is built. The Harness keeps each speaker's personality and voice together, resolves an action ID into text and voice, and requests synthesis; Core is not an action registry. Playback, audio caching, and lookahead are outside its scope.

## References, not dependencies

The original Fluidcast's BAML speaker and speak types inform this design. BAML and its previous TTS implementation are not requirements for V3. See [harness lifecycle](harness-lifecycle.md) for execution and [client integration](client-integration.md) for audio delivery ownership.
