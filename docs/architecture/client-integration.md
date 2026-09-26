# Client integration

## Connection and playback

The backend is authoritative; client state is limited to what communication, caching, and playback require. The application owns the server and transport; the Client SDK talks only to that backend. Provider credentials never belong in the browser. The integration surface is transport-neutral, with no required server framework or wire protocol. The Client SDK is also environment-neutral: the reference application runs it in a browser, but browser-specific concerns such as IndexedDB storage and autoplay belong to adapters or applications.

The harness must be notified of connection loss so it can freeze cursor advancement. The subscription stream itself confirms delivery, so there is no separate delivery acknowledgment; playback completion advances the current instruction and is distinct from the user's Next control. Playback instructions have their own identity so stale acknowledgments cannot advance a later playback.

On reconnection, the client can request a cursor reset and resume playback rather than reconstructing the exact amount of audio heard. Applications always supply actual playback and own error presentation.

## Tools and signals

Tools that need the user, such as Show and Ask, run on the backend and wait for the client. Each execution has its own identity, and the client's typed commands to a running tool carry it, so stale replies from an earlier execution are rejected. Clients import tool schemas from the tool packages; the Client SDK only carries commands.

The Harness exports two derived signals as pure functions over session state, which the Client SDK makes subscribable. **Presentation** (thinking, speaking, or idle) drives the player. **Attention** (working, needs you, idle, or error) tells applications whether the user is needed, independently of Away; see the [interaction model](../product/interaction-model.md). Stepping away and resuming are commands.

## Audio

The client can observe queued actions for prefetch, but only a harness play instruction authorizes playback. This visibility never authorizes early tool execution.

The harness resolves action IDs to content for Core TTS; Core does not maintain an ID registry. The harness requests speech but does not manage lookahead. The Client SDK prefetches the next three speak actions through the backend, using pluggable storage with in-memory and IndexedDB options.

If requested audio is not fully cached, only that action's in-flight prefetch is canceled and a fresh live-streaming request is used. Other downloads continue. Partial-download reuse and built-in playback are out of scope initially. Applications handle browser-specific concerns such as autoplay authorization.

See [harness lifecycle](harness-lifecycle.md) for Away, interruption, and recovery semantics. Exact routes, transport messages, and cache retention policies remain later design work.
