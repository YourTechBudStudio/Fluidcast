# Architecture overview

## Components and ownership

| Component                   | Responsibility                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core SDK**                | Stateless action generation and text-to-speech. Parses model output into an asynchronous action stream and generates action IDs without storing them. |
| **Harness SDK**             | Owns conversation history, action state, the playback cursor, tool execution, and iteration scheduling.                                               |
| **Browser SDK**             | Communicates with the application backend, coordinates playback with the harness, and prefetches/caches audio. Applications supply actual playback.   |
| **Application integration** | Owns the server, transport, UI, and connections between these components. No separate backend integration SDK initially.                              |

The browser talks only to the application backend, never directly to Core or model providers. Integration is transport-neutral; neither a server framework nor HTTP/SSE versus WebSockets is prescribed.

## Consequential decisions

See the [architecture decision records](../adrs/README.md) for the rationale and tradeoffs behind these boundaries.

- **[Core SDK](core-sdk.md):** Stateless generation, action streams, speakers, and TTS.
- **[Harness lifecycle](harness-lifecycle.md):** Cursor-driven execution, continuation, interruption, and recovery.
- **[Tools and agents](tools-and-agents.md):** Generic tool policies and agent-pool ownership.
- **[Browser integration](browser-integration.md):** Connection coordination, playback delegation, and audio caching.

These are architectural commitments, not final APIs. Exact schemas, parser mechanics, transport protocols, cache policies, and provider-specific adapters remain implementation design work.
