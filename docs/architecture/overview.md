# Architecture overview

## Components and ownership

| Component                   | Responsibility                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core SDK**                | Stateless action generation and text-to-speech. Parses model output into an asynchronous action stream and generates action IDs without storing them.                                                                              |
| **Harness SDK**             | Owns conversation history, action state, the playback cursor, tool execution, and iteration scheduling.                                                                                                                            |
| **Client SDK**              | Communicates with the application backend, coordinates playback with the harness, and prefetches/caches audio. It plays nothing itself: the React player or the application supplies actual playback.                              |
| **Tool packages**           | One package per tool (Show, Ask, Forward Agent): a backend factory the harness registers and a pure schema clients import. Forward Agent owns the session's one worker.                                                            |
| **Presets**                 | Voice behavior as configuration: instructions, worked examples, a speaker profile and reminders. The Guided Walkthrough preset has `compact` and `detailed` profiles.                                                              |
| **React player**            | One complete browser player for React hosts, built on the Client SDK: visuals, subtitles, controls, browser audio, composer, questions, Shows, transcript, and worker view. The host supplies a session connection and visibility. |
| **Application integration** | Owns the server, transport, backend session lifecycle, and connections between these components. Takes UI and playback from the React player or supplies its own. No separate backend integration SDK initially.                   |

The reference backend and web app demonstrate integration; they are examples, not a distributed application.

Clients talk only to the application backend, never directly to Core or model providers. Integration is transport-neutral; neither a server framework nor HTTP/SSE versus WebSockets is prescribed.

## Execution model

The project is [Effect v4-native](../adrs/0003-effect-native-execution.md), including public SDK operations and streams. Effect supplies the shared concurrency, resource-lifecycle, and failure-handling model; external APIs are adapted at integration boundaries. It is an intentional foundational dependency, not a change to component ownership.

## Consequential decisions

See the [architecture decision records](../adrs/README.md) for the rationale and tradeoffs behind these boundaries.

- **[Core SDK](core-sdk.md):** Stateless generation, action streams, speakers, and TTS.
- **[Harness lifecycle](harness-lifecycle.md):** Cursor-driven execution, continuation, interruption, and recovery.
- **[Tools and the worker](tools-and-agents.md):** The generic tool contract, the initial tools, and the session's one worker.
- **[Client integration](client-integration.md):** Connection coordination, playback delegation, and audio caching.
- **[React player](react-player.md):** The complete embeddable player, what hosts supply, and what it guarantees.
- **[Presets and instructions](../product/presets.md):** Where the voice's behavior comes from, and the Guided Walkthrough preset.

These are architectural commitments, not final APIs. Exact schemas, parser mechanics, transport protocols, cache policies, and provider-specific adapters remain implementation design work.
