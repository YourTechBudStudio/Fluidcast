# Guided walkthrough prompting

A compressed record of tuning a small voice model for the Guided Walkthrough preset, so future tuning starts from evidence. Measured in October 2026; the raw runs, judge outputs and evaluation scripts stay local because the cases are private transcripts.

## Setup

- **Model:** Qwen3.8-27B (W4A16), served by vLLM with server-enforced JSON (`disable_any_whitespace` on), medium reasoning, temperature 0.3. Ceiling probe: GPT-6.1 SOL, low reasoning, without enforced JSON.
- **Cases:** about 40 real worker replies from brainstorming and design sessions (status reports, long proposals, many-question replies, multi-message turns, late-session histories), split into dev cases and 11 held-out cases the tuning never saw; plus interrupt and plain-agreement routing cases.
- **Runs:** each case is a full walkthrough with a scripted listener that presses Continue and gives realistic answers, including one deferral ("I'd go with what you recommend") per case where plausible.
- **Scoring:** blind LLM judges score each run against gold points and questions (fidelity first, then burden, screens, speech, pacing, speed and engagement) into a 0–100 composite; blind pairwise judges compare prompts head to head; deterministic metrics cover copying, compression, the share of questions actually answered, and routing.
- **Scale:** 10 rounds, 41 prompt variants, about 6,200 walkthroughs, about 3,000 absolute and 1,450 pairwise judgments.

## Results

Held-out, 11 cases × 3 runs:

|                            | Starting drive prompt | Final (`detailed`)              | Previous flow prompt | SOL + final prompt |
| -------------------------- | --------------------- | ------------------------------- | -------------------- | ------------------ |
| Composite                  | 71.4                  | **74.1** (+2.7, 90% CI 0.2–5.2) | 54.3                 | 79.2               |
| Invented claims per run    | 2.39                  | **1.09**                        | 0.88                 | 0.09               |
| Detail recall              | 0.91                  | **0.95**                        | 0.92                 | 0.95               |
| Spoken words per segment   | 61                    | **24**                          | —                    | —                  |
| Listen time ÷ reading time | 1.32                  | **0.99**                        | 1.21                 | 1.08               |
| Screen copying             | 0.50                  | 0.56                            | 0.65                 | 0.33               |

- Blind judges preferred the final prompt over the start in 22 of 32 decided pairs.
- Dev-round gains looked like about +11; the honest held-out gain is +2.7, because the rubric and listener tightened between rounds and winners picked on small samples regress.
- On the same mid-way prompt, SOL scored 81.9 and Qwen 70.9: the gap was fidelity discipline (0.5 vs 2.4 invented claims per run, questions placed where they arise), not screens or speed. GPT-6-LUNA broke the output format in 16% of runs without enforced JSON and scored below Qwen.
- Routing is solved for both prompts: redirect interrupts are forwarded first, and plain agreements continue the walkthrough, 100% of the time.
- The `compact` profile has not been measured. The obvious first test is `compact` against `detailed` on SOL over the held-out cases.

## What moved the score

| Change                                                                                            | Effect                                                                                              |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Drive mode instead of presenting the whole reply at once                                          | +17 composite on held-out; the flow prompt dumped everything and left half the questions unanswered |
| One compact worked walkthrough example                                                            | +3.0: shorter speech, less copying, better recall                                                   |
| The example's worker reply as two messages (an interim note, then the report)                     | +1.9: interim notes and their questions stop being skipped                                          |
| A check-question example plus "answer kept for your work, which judges it" in the answer reminder | +3.1, pairwise 0.64: the voice stopped grading answers (9 → 0)                                      |
| A prose report shown as one line per point ("fact → reason")                                      | Pairwise 0.61: fewer invented claims                                                                |
| Bare option labels (no `description` field in the schema)                                         | Invented option text 35 → 3 per 120 runs, with no prompt text                                       |
| An inline invitation in the example, asked as a choice                                            | Offers reaching the listener 0.58 → 0.72                                                            |

## Lessons for prompting a small model

- **Examples beat rules.** Every behavior tried both ways was won by a worked example; all four rule-only reminder fixes in one round lost (−2.8 to −9.7).
- **The model copies everything in an example,** most of all its last move: a closing "One moment." became promises after forwarding; a closing "Ready to send your answer?" became a stop that swallowed real offers. Fix copied behavior by editing the example, not by adding a rule against it.
- **Reminders are load-bearing but must stay short.** Removing them cost question recall; every extra clause was acted on at the expense of something else. A reminder works best when an example already shows the behavior.
- **Schema changes are the cleanest lever** when the behavior lives in a field.
- **Word budgets compress by cutting.** A ~40-word cap per screen cut copying from 0.46 to 0.16 but dropped the "so what" line, caveats and listener actions first; five follow-up variants could not win the recall back. Compress per point, not per screen.
- **Position matters:** a routing example placed after the walkthrough example made walkthroughs worse; placed first, it was neutral.
- **Negative instructions don't reach reflexes:** "don't confirm or correct" stopped grading but not turning answers into decisions ("B it is").
- **Invalid output was an infrastructure problem:** a stray quote under constrained decoding became a whitespace runaway until the server forbade free whitespace.

## Still weak in the final prompt

1. Screens copy the reply (lightly trimmed bullets, pasted tables) in about half the runs.
2. Soft questions and recommendations are left behind a Continue instead of being asked.
3. Answers are turned into decisions, mostly after a deferral.
4. Replies with many questions: questions merged, held to the end, or asked without their setup.
5. Compression drops a caveat or a section's "so what"; the reply's last lines are sometimes lost when the forward follows the last answer.

After the loop, a small check (8 cases × 2 runs, plus the routing cases) replaced the application's product-specific identity line with one neutral role sentence (an agent behind the tool does the real thinking and work; the voice speaks its replies as its own) and renamed the tool `forward_agent`. It stayed within noise of the final prompt (−1.5 composite, interval spanning zero), with routing unchanged and no third-person slips; decision questions were asked slightly less often (0.85 vs 0.95, small sample), to confirm on the full set.

Untested next steps with the best evidence: fold the example's closing "Next" line into the last question and drop its final Continue; extend the answer reminder so the voice never says what an answer decides; replace the example's closing "One moment." with a strictly neutral hold; separate a pasted listener message from the worker's reply in the forward result.

## Lessons about the measurement

- Freeze the scripted listener and rubric before tuning, or re-measure the incumbent whenever either changes; both changed several times here, which is why dev gains cannot be summed.
- Gate on fidelity from the start (core and detail recall, the share of questions actually answered, and a pairwise fidelity veto). A composite that rewards presentation promoted a prompt that lost content.
- Count a question as asked only when it has its own answer slot; catch-all asks ("your answers to these six?") otherwise score as perfect.
- Use a case-clustered, seeded bootstrap; reps of one case fail together.
- Use absolute anchors for drift-prone gates such as copying; a gate relative to the incumbent ratcheted upward each promotion.
- Screen on more cases: 8 cases × 2 runs overstated dev gains by 3–8 points. Check held-out once mid-way, not only at the end.
