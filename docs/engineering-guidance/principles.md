# Principles

These goals are durable. Fluidcast-specific context lives in the [entry point](./README.md); concrete questions and severity calibration live in the lenses.

## Optimize for future change

Does the design make the next likely change easier without building for hypothetical requirements? Prefer clean internal interfaces and migrate callers when safe. Preserve compatibility deliberately where users, stored data, integrations, or deployments actually depend on it.

## Localize change within the owning package

Can a coherent change stay within the package that owns the responsibility? Core, Harness, Browser, and the applications each own distinct facts and decisions. Keep code that changes together close without pulling state, policy, or credentials across those boundaries merely to colocate it.

## Prefer deep modules with legible surfaces

Does a small, understandable interface hide meaningful complexity? Concentrate complexity intentionally rather than spreading it across shallow wrappers. A public SDK surface should let an integrator succeed without learning its internals; a deep module may contain multiple focused files whose internal flow remains easy to navigate and reason about locally.

## Make ownership and contracts explicit

Who owns each fact, decision, and effect? Make real boundaries explicit enough that callers can understand guarantees and failures without knowing implementation details. Be explicit about what applications must supply. Avoid interface ceremony where no meaningful boundary exists.

## Reuse to prevent meaningful drift

Are similar components, functions, or modules expressing the same behavior or rule? Actively look for shared implementations that prevent behavioral or logic drift. Do not trade away readable code, clear boundaries, or local reasoning merely to remove similar-looking lines.

## Keep state and operational behavior explicit

What causes a transition, what can fail, and how long can work live? Make state changes causal, effects bounded, and resource ownership clear. Prefer established primitives that capture the required guarantees over weaker custom implementations.

## Keep outcomes honest and failures diagnosable

Can listeners, integrators, and operators distinguish success, pending work, cancellation, partial completion, and failure? Make degradation and recovery understandable, and expose useful diagnostic context without leaking conversation content or credentials.

## Treat experience as engineering behavior

Can people understand and steer the conversation, including when something goes wrong? Can integrators build that experience truthfully from what the SDKs expose? Responsive interaction, truthful status, consistent control semantics, and a legible integration surface are engineering concerns, not optional decoration.
