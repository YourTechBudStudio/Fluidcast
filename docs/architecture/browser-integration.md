# Browser integration

## Connection and playback

The backend is authoritative; browser state is limited to what communication, caching, and playback require. The application owns the server and transport; the browser SDK talks only to that backend. Provider credentials never belong in the browser. The integration surface is transport-neutral, with no required server framework or wire protocol.

The harness must be notified of connection loss so it can freeze cursor advancement. Delivery acknowledgment confirms receipt only; playback completion advances the current instruction and is distinct from the user's Next control. Playback instructions have their own identity so stale acknowledgments cannot advance a later playback.

On reconnection, the browser can request a cursor reset and resume playback rather than reconstructing the exact amount of audio heard. Applications always supply actual playback and own error presentation.

## Audio

The browser can observe queued actions for prefetch, but only a harness play instruction authorizes playback. This visibility never authorizes early tool execution.

The harness resolves action IDs to content for Core TTS; Core does not maintain an ID registry. The harness requests speech but does not manage lookahead. The browser SDK prefetches the next three speak actions through the backend, using pluggable storage with in-memory and IndexedDB options.

If requested audio is not fully cached, only that action's in-flight prefetch is canceled and a fresh live-streaming request is used. Other downloads continue. Partial-download reuse and built-in playback are out of scope initially. Applications handle browser-specific concerns such as autoplay authorization.

See [harness lifecycle](harness-lifecycle.md) for pause, interruption, and recovery semantics. Exact routes, transport messages, and cache retention policies remain later design work.
