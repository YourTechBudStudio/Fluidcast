# React player

## Purpose and boundary

The React player is one complete, embeddable browser player built on the Client SDK. It is published, provisionally, as `@yourtechbudstudio/fluidcast-react`. It contains the whole listening experience: visuals, subtitles, transport controls, browser audio and autoplay handling, the composer, questions, Shows, the transcript, the worker view, React state, and presentation error and recovery. Hosts embed that experience instead of rebuilding it, and the reference web app consumes the same player, so fixes do not drift between hosts.

Its public surface is deliberately narrow: one complete player component and one stylesheet. Its controls, panels, state and visuals are internal modules, not a component library. It adds no theme or layout API.

The player is a client in the sense of [ADR 0001](../adrs/0001-state-ownership.md): it keeps only communication, caching, playback and presentational state, and imports only pure protocol and tool-schema exports. The Client SDK stays environment-neutral and does not depend on it.

## What the host supplies

- **A session connection.** A transport for one backend session, covering conversation commands, events, and speech, plus worker status and transcript streams. It reuses the Client SDK's transport abstraction. The player never sees provider credentials, URLs, routes, agents, or the host's configuration.
- **Visibility.** Whether the host is showing the player now.
- **Keyboard focus.** The host decides when the player receives keys by focusing its root. The player never focuses itself.
- **A sized container.** The player fills the element it is placed in.

## What stays with the host

Routing, setup and mode selection, backend session creation and destruction (the reference app's Reset), connection construction and its failure UI, provider keys and agent launch, and the host's own chrome around the player, such as pane controls.

## What the player guarantees

- **Instances are isolated.** Each mounted player has its own conversation state, audio element and audio context, Show reporting, visual state, and keyboard handling. Two visible players can play at once; there is no audio arbitration.
- **Layout follows the container**, never the viewport, and switches to its compact layout in narrow containers. Every part of the interface fits inside the container.
- **Styles are contained.** The player's stylesheet is compiled and scoped to its root, so it does not restyle the host page. Model-generated Show content is the exception: it is trusted and keeps its existing, uncontained rendering.
- **Shortcuts are scoped.** Player shortcuts act only while focus is inside that player. Keys it consumes are marked as handled so hosts can skip them, and the player never stops them propagating.
- **Hiding pauses; showing resumes nothing.** Becoming hidden pauses the session and silences the player at once. Becoming visible changes nothing until the listener acts. Visibility is distinct from focus.
- **Existing sessions start on a tap.** Entering a session never autoplays. Audio starts only after an explicit presentation intent, such as Play, Tap to start or resume, sending a message, or answering a question. Other gestures inside the player, such as opening panels or typing, do not start it.
- **Disposal releases, never destroys.** Unmounting the player, or replacing its connection, releases its subscriptions, streams, audio resources, and listeners. It never destroys the backend session; the player has no destroy path.

See [client integration](client-integration.md) for the Client SDK boundary underneath the player.
