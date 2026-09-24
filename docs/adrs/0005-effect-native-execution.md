# ADR 0005: Effect-native execution and state with Effect v4

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Fluidcast coordinates streamed generation, playback, concurrent tools, cancellation, and recovery across several SDKs. Independently managing these lifecycles with ad hoc promises and callbacks would multiply concurrency and cleanup conventions at their boundaries.

Applications also present that streamed, backend-owned state in reactive UIs. Separate data-fetching and state-management libraries would introduce a second asynchronous model, a second cancellation and retry model, and a boundary where typed failures collapse into untyped errors.

## Decision

The project uses Effect v4 throughout: Core, Harness, Browser SDK, and applications, including their UI layers. SDK contracts are Effect-native, including asynchronous operations and streams, rather than treating Effect as a hidden implementation detail behind Promise-first APIs.

Use Effect's structured concurrency, resource management, and typed failure handling to express lifecycle ownership consistently. Adapt external provider, transport, and playback APIs at integration boundaries; add convenience facades only when needed.

Effect also owns reactive application state. Applications use Effect's reactivity modules, such as `Atom`, `AtomRef`, `AsyncResult`, and `AtomHttpApi`, for client state and asynchronous data rather than libraries such as React Query or Zustand. UI frameworks consume that state through thin bindings.

## Consequences

- Effect is an intentional foundational dependency; the dependency-light principle still applies to additional libraries.
- Applications are expected to be Effect-native, including UI state. This accepts ecosystem coupling and excludes consumers who cannot adopt Effect, in exchange for one execution, failure, and cancellation model from SDK streams to rendered state.
- Typed failures and interruption can flow from SDK streams into UI state without translation through untyped caches or stores.
- Reactive state in the browser remains a projection of backend authority (ADR 0003), not an independent conversation state machine.
- Effect v4 is pre-release and its reactivity modules are marked unstable. Expect API churn, and accept giving up the maturity and tooling of established React data and state libraries.
- Resource lifetime and cancellation ownership must be explicit. Effect provides mechanisms, not proof that Fluidcast's scheduling or interruption rules are correct.
- Canceling local work does not guarantee that an external agent or provider stopped. Existing tool cancellation and late-result rules remain application semantics.
- This decision changes how SDKs and applications express execution and state, not SDK ownership boundaries or the choice of server framework and transport.

See the [architecture overview](../architecture/overview.md), [Browser integration](../architecture/browser-integration.md), and [Harness lifecycle](../architecture/harness-lifecycle.md).
