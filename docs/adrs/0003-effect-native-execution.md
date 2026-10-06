# ADR 0003: Effect-native execution and state with Effect v4

## Status

Accepted as architectural direction; implementation is not implied.

## Context

Fluidcast coordinates streamed generation, playback, concurrent tools, cancellation and recovery across several SDKs. Managing these lifecycles with ad hoc promises and callbacks would multiply concurrency and cleanup conventions at every boundary. Our applications also present streamed, backend-owned state in reactive UIs; separate data-fetching and state libraries would add a second asynchronous, cancellation and retry model, and a boundary where typed failures collapse into untyped errors.

## Decision

Fluidcast is built on Effect v4 throughout: Core, Harness, Client SDK, tool packages, presets, and our applications, including their UI. SDK contracts are Effect-native, including asynchronous operations and streams, rather than hiding Effect behind Promise-first APIs. Structured concurrency, resource management and typed failures express lifecycle ownership consistently, and external provider, transport and playback APIs are adapted at integration boundaries.

Our applications also use Effect for reactive state: Effect's reactivity modules for client state and asynchronous data, consumed by UI frameworks through thin bindings, rather than libraries such as React Query or Zustand. How integrators build their own applications is their choice.

## Consequences

- Effect is an intentional foundational dependency; the dependency-light principle applies to everything else.
- Integrators consume Effect-native contracts, which ties them to the Effect ecosystem at the SDK boundary.
- In our applications, typed failures and interruption flow from SDK streams into UI state without translation through untyped caches or stores.
- Effect v4 is pre-release and its reactivity modules are unstable: expect API churn and less mature tooling.
- Resource lifetime and cancellation ownership must be explicit; Effect provides mechanisms, not proof that Fluidcast's scheduling rules are correct.
- Canceling local work does not guarantee that an external worker or provider stopped.

See the [architecture overview](../architecture/overview.md).
