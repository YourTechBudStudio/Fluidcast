# Core SDK

## Stateless generation

Core accepts caller-owned conversation history, system instructions, tool definitions, and speaker profiles. It targets OpenAI-compatible chat completions and asks the model for a JSON array of **speak** and **tool-call** actions rather than native tool calls, allowing speech and multiple tool requests in one response.

Core parses that output incrementally into an Effect-native action stream and assigns action IDs itself. It stores neither those IDs nor conversation history. Generation and parsing failures surface to the harness, which owns recovery.

Tool results and queued key-value context accompany subsequent conversation input. XML-style envelopes and TypeScript-style schema descriptions are the intended prompting direction; exact formats remain open. There is no model-generated end action, and runtime error actions belong to the harness.

## Speech and TTS

Speaker profiles contain an ID, name, and personality. Each speak action contains a speaker ID and content; multiple speakers alternate through separate actions. There is no tone field initially. Generation should favor bounded speech segments, no longer than roughly one or two minutes.

Core also provides OpenAI-compatible TTS with explicit speaker-to-voice configuration. The backend resolves an action ID into text and speaker configuration before requesting synthesis; Core is not an action registry. Playback, audio caching, and lookahead are outside its scope.

## References, not dependencies

The original Fluidcast's BAML speaker and speak types inform this design. BAML and its previous TTS implementation are not requirements for V3. See [harness lifecycle](harness-lifecycle.md) for execution and [browser integration](browser-integration.md) for audio delivery ownership.
