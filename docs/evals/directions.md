# The user's standing directions (obey these)

- Drive mode only: one segment per response, pause, continue on non-interrupt input; interrupt → forward now.
- The voice splits the worker's reply itself. Do not split the reply into parts in code, and do not instruct the worker how to format (avoid controlling worker output).
- Answers to worker questions go back in one forward at the end of the walkthrough.
- Everything the listener says that isn't Continue/an answer is forwarded; the voice never answers questions about the subject itself. Questions/pushback come through Interrupt, which carries a reminder to forward.
- The test is about prompting; harness mechanics come later. Keep the harness idea generic: swappable baked-in prompts, reminders on tool results and on user messages.
- Keep tool descriptions brief. Use reminders smartly: Qwen respects the newest user message most.
- Personality is fine (e.g. "got it", "good news") as long as meaning is kept; every worker point and question must reach the listener.
- Speech is for orientation; the screen does the heavy lifting, but screens must compress meaningfully, not restate the worker.
- Qwen at medium reasoning is the target. GPT-6.1 SOL only on small samples as a ceiling probe, default service tier (no priority).
- Qwen server: ~6–9 concurrent requests. Run cases back to back to reuse the prefix cache. Screen small first; full runs only for promising candidates.
- (Orchestrator, from the user's priorities) Fidelity first: compression is wanted, but never at the cost of points or questions. A tighter screen that drops a reason, caveat, step or "so what" line is a regression, whatever the composite says.
- (User, round 7) Agreement-only interrupts don't matter: the user never interrupts just to agree. Interrupts are reserved for breaking the flow to redirect the worker now; those must be forwarded first. A typed agreement that is NOT an interrupt ("Sounds good", "Okay, makes sense") means keep going: continue walking through the last worker reply.
- (User, before round 8) Priorities, ranking and composite weights approved as they stand (fidelity 40 incl. hard gates; burden/screens/pacing/speed; engagement; routing as gates).
- (User) Model latency doesn't matter for now: no latency gate.
- (User) Worker offers ("I can also publish this as a page") are questions: they must be asked.
- (User) Option descriptions don't matter: the `description` field may be dropped from the ask schema entirely (`tools.askOptionDescriptions: false`).
- (User) Short replies: no preference on whether they pause; no rule either way.
