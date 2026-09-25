# Architecture and SDK surfaces

Use this lens for package ownership, public SDK surfaces, integration contracts, shared behavior, trust boundaries, dependencies, and interface changes. The goal is to localize change without hiding ownership or coupling unrelated concerns.

## Questions

- Does the change respect the ownership recorded in the ADRs? Core stays stateless, the Harness owns conversation state and the cursor, and the Client SDK coordinates communication and audio without an independent conversation state machine. Do browser caches and buffers remain distinguishable from backend authority?
- Does each public surface expose a small, meaningful interface that hides complexity, or does it force integrators to coordinate internals, ordering, or bookkeeping the SDK should own?
- Is it explicit what an application must supply (server, transport, UI, playback, storage) and what the SDK guarantees in return? Does integration stay transport-neutral, without assuming a server framework, wire protocol, or player?
- Are public surfaces consistently Effect-native, with typed errors, streams, and requirements visible in their types? Are internal representations or incidental Promise-based paths leaking into public or serialized contracts?
- Can the behavior be understood locally within a package? Are dependencies and control flow legible without chasing shallow wrappers, generic registries, or unrelated helpers? Does the Harness stay generic over tool policies rather than branching on particular tool or agent names?
- Would sharing a function, type, or module prevent meaningful drift between packages or between SDKs and reference apps? Would the proposed sharing instead couple packages that should evolve independently or pull backend concerns into the browser?
- Can an internal or pre-launch interface be replaced and its callers, including reference apps, migrated cleanly rather than retaining shims, obsolete paths, or dual systems? Where a real external boundary exists, what compatibility obligation actually applies?
- Is model output treated as untrusted input, including parsed actions and presented HTML? Do provider credentials and provider access stay server-side? Does the voice model choose only targets and messages, never infrastructure configuration?
- Does a new dependency justify its weight in every consumer's install, and in browser bundles that include the Client SDK? Does it introduce unnecessary privilege, coupling, or public-surface exposure? Does it duplicate a responsibility Effect already owns, such as state, data fetching, retry, scheduling, or streaming, creating a second model for failures and cancellation?

Deep modules do not mean giant files. Shared code should have a coherent responsibility, not become a miscellaneous destination for anything used twice. Reference apps demonstrate integration; they should not become where SDK responsibilities quietly live.

## Severity calibration

- **Blocker** — a boundary or contract failure materially threatens correctness, security, or the ADR ownership model; for example, provider credentials reach the browser, the browser becomes an independent source of conversation truth, model-supplied content reaches a privileged sink without validation, or Core begins storing conversation state.
- **Concern** — structure has a concrete change cost, drift risk, or integration burden; for example, integrators must replicate SDK bookkeeping, the Harness special-cases a named tool, a public surface mixes Effect and ad hoc Promise conventions, an application adds a parallel state or data-fetching layer alongside Effect's reactivity, duplicated rules already differ, or unnecessary compatibility paths maintain two internal behaviors.
- **Nit** — a small optional improvement to grouping or surface clarity with no meaningful ownership, coupling, or drift consequence. A preference for another folder layout alone is not a finding.

Use the [review-consumption rules](../how-to-use.md#consuming-severity-findings) for next steps. Transition, cancellation, and lifecycle problems belong primarily in [state, runtime, and diagnostics](./state-runtime-and-diagnostics.md).
