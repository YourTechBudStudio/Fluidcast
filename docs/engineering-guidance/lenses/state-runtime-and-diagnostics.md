# State, runtime, and diagnostics

Use this lens for ordering, state transitions, the playback cursor, background work, Effect primitive use, failure handling, and runtime visibility. Fluidcast is Effect-native: the question is whether the right primitives serve the job, not whether the code has reached a prescribed adoption tier.

## Questions

- What action causes each state transition? Are its scope and cost proportionate, or does an apparently local operation trigger hidden mutations or broad work?
- Is generation kept distinct from execution? Does anything take effect before the cursor reaches it, or reorder what the model emitted? Does prefetch or visibility ever authorize execution or playback?
- Who owns in-flight generation, tool work, agent sessions, prefetches, and connections? What happens on pause, disconnect, interrupt, rewind, repeated requests, concurrent updates, or shutdown where those situations apply?
- Can stale or late events change current state? Consider acknowledgments for earlier playback, results from canceled tool calls, responses from abandoned generations, and prefetches for actions that no longer lead playback. Is identity, not timing, what rejects them?
- Does interruption or rewind avoid duplicating executed work, resurrecting canceled work, or losing already-received results that should remain eligible? Does retry continue from retained history and queued inputs rather than replaying the conversation?
- Is reactive UI state a projection of SDK streams, or does it copy and transition conversation state independently? Do UI-driven subscriptions and requests end when their consumers go away, without cutting off work the backend should continue?
- Is turn completion derived from actual outstanding work, or can an empty queue, a quiet player, or a missing event be mistaken for completion?
- Are we recreating behavior that Effect primitives would implement better? Look especially at streams, interruption, scopes and resource cleanup, queues, concurrency limits, timeouts, retry, and batching over time.
- Are expected failures distinguishable with appropriate tagged errors and typed error channels, or have custom error conventions and generic exceptions weakened caller handling? Do Promise-style bridges, detached fibers, or callback boundaries lose Effect's failure or interruption guarantees?
- Would an appropriate Effect primitive clarify dependencies, lifecycle, or composition? Conversely, is machinery being introduced without a problem to solve?
- Can an integrator or operator understand a failure from exposed errors, state, and events? Is enough context retained to identify the failing operation, action, or tool invocation without the SDK logging indiscriminately on the application's behalf?
- Do errors, events, and diagnostics avoid exposing conversation content, agent output, prompts, or credentials beyond what the consumer needs? Does a provider, TTS, or agent failure leave behavior bounded and understandable?

Do not mandate services for every helper, logging for every function, or a particular concurrency mechanism regardless of need. Do not hesitate to introduce Effect primitives when they replace weaker custom machinery with the guarantees the problem requires.

## Severity calibration

- **Blocker** — an operational gap materially threatens lifecycle correctness, agent work, or security; for example, a tool executes before the cursor reaches it, a stale acknowledgment advances later playback, a late result from a canceled call re-enters history, retry reruns executed agent work, or diagnostics expose credentials.
- **Concern** — a concrete failure-handling, maintenance, or diagnosis gap; for example, generic errors prevent intended recovery, custom scheduling or cancellation machinery loses required semantics, interruption leaks running fibers or connections, a small action causes unjustified broad work, or failures lack the context needed to identify their cause.
- **Nit** — an optional local improvement in primitive use or diagnostic clarity where existing behavior and guarantees are sound. Missing an Effect primitive is not a Blocker by itself.

Use the [review-consumption rules](../how-to-use.md#consuming-severity-findings) for next steps. What listeners and integrators can observe and act on belongs primarily in [conversation experience](./conversation-experience.md).
