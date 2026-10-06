# Evaluating voice behavior

This is how we measured and improved the voice's behavior: the method, the rules that took several rounds to get right, and what did and did not work in running it. It is a specification, not code. The harness that produced the Guided Walkthrough preset is not kept: a coding agent given this document, the two rubrics beside it and the current packages can rebuild it. What the measurements found about prompting is in [Guided walkthrough prompting](../research/guided-walkthrough-prompting.md); the preset is described in [Presets and instructions](../product/presets.md).

- [judge-rubric.md](judge-rubric.md): the absolute rubric judges score every walkthrough with. Its wording drives the judges, so it is kept as written; its title carries the version.
- [pairwise-rubric.md](pairwise-rubric.md): the blind A/B rubric.

## Goal and priorities

A good walkthrough gets every point and question of the worker's reply to the listener, with less effort than reading the reply, without being much slower, and engagingly. In priority order:

1. **Fidelity**: nothing lost, distorted or invented. Every worker question reaches the listener with a way to answer it; offers and soft invitations ("say the word if…") are questions.
2. **Cognitive burden**: one idea at a time, screens that compress meaningfully (not copies of the reply), speech that introduces each screen and then gives its highlights, so the listener skims the screen instead of reading it all.
3. **Speed** against reading the raw reply.
4. **Engagement**: it feels like a sharp colleague talking you through it.

Routing is pass/fail: an interrupt is forwarded first with one neutral line and nothing after it; a plain typed agreement ("Sounds good") keeps the walkthrough going. Not judged: model latency, the voice's personality where meaning holds, short replies pausing or not, agreement-only interrupts (the listener never interrupts just to agree).

## The method

### Cases and gold

Cases are real worker turns mined from Claude Code transcripts of design sessions, chosen for variety: short answers, many questions, tradeoff tables, code, diagrams, status reports, replies after pushback or confusion, multi-message turns, late-session turns with an earlier walkthrough in the history. Each case holds the listener's message, the worker's reply as its list of top-level messages (production forwards every message since the last forward, so keep the boundaries), and optionally earlier history. They contain private text, so they and everything derived from them stay out of the repository.

Gold is written once per case by a strong model and spot-checked:

- **Points**: atomic claims, each `core` (needed to follow or decide), `detail`, or `narration` (the worker describing its own process; not scored).
- **Questions**: everything the worker asks, with its options and recommendation, a kind (`decision`, `check`, `quiz`, `offer`, `info`), the scripted listener's realistic `answer` and `pick`, and at most one per case marked as the listener deferring ("I'd go with what you recommend").
- Verbatim items, a few comprehension questions and a one-line gist.

Sets: `screen` (8 diverse cases for quick checks), `dev` (about 40, the comparison set), `heldout` (11, touched only at the end), redirect interrupts, and plain agreements. Routing cases reuse a reply and replace one listener input with an interrupt or an agreement at a given step; they need no gold.

### One run

```text
seed: listener message → forward call + holding line → the worker's reply arrives
loop:
  render the prompt exactly as production does (Core's history rendering) with the preset under test,
    its reminder attached to the newest input
  generate with server-enforced JSON; keep the actions as they close
  broken reply      → keep what closed, add the cut-off notice, retry once (with a reminder to quote
                      with single quotes); two in a row ends the run as invalid
  forward written   → done
  asks open         → the scripted listener answers them
  no screens, no asks after the first response → done
  otherwise         → the listener says "Continue."
cap: 12 responses + one per gold question; routing cases stop after the response to the interrupt or agreement
```

Qwen ran at temperature 0.3 with medium reasoning, three runs per case. Every run records each response's raw output, parsed actions, timings, and the listener's input with the gold question it matched.

### The scripted listener

It took three versions to stop the listener from distorting results; these are the rules that held:

- **Continue**: an ask is a Continue only if it is a readiness check (a single Continue option, or at most two options, one saying continue, next or ready, under a question like "Ready for the next part?"). Anything else is a question, even with a "Looks good, next" option.
- **Matching a question to gold**: content-word overlap between the ask (its question and option labels) and each gold question (its text and pick); an already-answered gold question is penalised. It matches at 0.25 or more, or at 0.12 or more when the ask is not approval-shaped.
- **Answering a match**: the deferral if that question is marked for it; otherwise the option closest to the gold pick, or the gold answer in free text when no option is close.
- **Unmatched asks are questions the worker never asked**: an approval-shaped one ("Does that work for you?") gets "Sure, that works."; any other gets "No strong opinion on that one." Never hand an unmatched ask the next gold answer: the voice then believes a real question was answered and never asks it.

### Judging

Judges are agents. Each gets a batch of about ten blind packets (context, the worker's reply, the gold, the walkthrough rendered as the listener experiences it) and writes the rubric's JSON beside each. They never see which prompt produced a run. Judgments are stamped with the rubric version; changing the rubric means re-judging every run being compared.

Pairwise judges see one reply and two walkthroughs in an order fixed by a hash, and say which the listener would rather get, how strongly, and which is more faithful. It is the second instrument: it caught gains the composite missed and a promotion the composite would have made wrongly.

### Metrics

From the judges: core and detail recall, question rate (asked 1, only spoken 0.5), distortions and additions per run, the 1–5 scores (burden, screens, speech, pacing, speed, engagement) and an overall 0–10.

Judge-free, computed from runs, gold and listener matches:

| Metric                    | Definition                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| answered                  | Share of gold questions the listener actually matched and answered: catches questions a judge credits but nobody could answer                              |
| goldCov                   | Share of gold points whose word stems appear in speech, screens or asks: tracked judged recall within about 0.03                                           |
| copy                      | Share of screen word 4-grams copied verbatim from the reply                                                                                                |
| compr                     | Screen words ÷ reply words                                                                                                                                 |
| time×                     | Estimated listening (speech at 160 wpm, screens read at 240 wpm, 1.2 s per diagram node) ÷ reading the reply at 240 wpm                                    |
| clean forward             | After an interrupt: `forward` first, nothing shown or asked after it, and a holding line that neither continues ("Next up…") nor decides ("I'll go with…") |
| continued after agreement | After a plain agreement: the next response shows or asks something and does not forward                                                                    |
| ok                        | The run ended with a forward or a natural close, not invalid or capped                                                                                     |

### Composite, comparison and promotion

The composite (0–100) per run is fidelity 25 (0.75 core recall + 0.25 detail recall), questions 15, overall 15, burden 10, screens 8, pacing 7, speed 7, speech 5, engagement 5 and protocol 3, minus up to 15 for distortions (5 each) and additions (3 each).

Comparisons are paired on (case, run) and use a seeded bootstrap that resamples cases with all their runs, because runs of one case fail together. A candidate replaces the champion when, on the `dev` set at three runs per case:

- its composite gain is above +1.0 with the 90% interval above zero, **or** it wins at least 60% of blind pairwise comparisons, wins more cases than it loses, and does not lose on the composite;
- **and** it passes every gate against the champion: core recall down at most 0.02, detail recall at most 0.05, question rate at most 0.03, answered share at most 0.03, distortions plus additions up at most 0.15 per run, ok rate at least 0.95, copy and compr up at most 0.05, clean forward and continued-after-agreement down at most 0.1;
- **and** the pairwise judges do not veto it: a candidate that wins under 45% of pairwise comparisons and is judged more faithful in under 40% of them is recorded as promising but not promoted, whatever the composite says.

A tie that makes the prompt shorter or simpler may also be promoted.

## The unattended loop

Each round is one orchestrated run of fresh agents. Between rounds, the orchestrator (a person or a long-running session) reviews the analyst's proposals, applies measurement changes deliberately, checks the promotion against the fidelity numbers, and starts the next round.

| Phase        | Agents                | What happens                                                                                                                                                                                                                                 |
| ------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Propose      | 1                     | Reads the journal, insights, backlog and real failures; writes 3–4 variants, each one hypothesis with a stated parent and up to 3 target cases, and smoke-tests each                                                                         |
| Screen       | 1 runner              | Runs candidates and the champion on the `screen` set at two runs, their target cases, and the routing cases                                                                                                                                  |
| Judge screen | ~10                   | Blind absolute judging                                                                                                                                                                                                                       |
| Select       | 1 runner              | Aggregates; candidates within a point of the champion whose screen recall is within 0.03 (core) and 0.07 (detail) go on, at most 2–3                                                                                                         |
| Full run     | 1 runner              | Finalists and the champion on `dev` at three runs, plus routing; the runner must verify every run exists and is re-dispatched if not                                                                                                         |
| Judge full   | ~12 + ~6 per finalist | Absolute judging, and blind pairwise against the champion                                                                                                                                                                                    |
| Decide       | 1                     | Applies the promotion rule; updates the champion, leaderboard and journal                                                                                                                                                                    |
| Analyze      | 1                     | Finds what still fails and whether the measurement rewards the wrong thing; updates insights and backlog; may add cases with gold to `dev` and additive diagnostics, but never changes scoring itself; writes proposals for the orchestrator |

State carried between rounds, in plain files: the champion, a leaderboard, a journal (one entry per round, with orchestrator notes), durable insights with evidence, a ranked idea backlog, proposals for the orchestrator, and the product owner's standing directions, which every agent reads first. A round took 1.5–3 hours and 30–50 agents.

### How the workflow is built

We ran each round as a Claude Code workflow script: deterministic control flow in code, judgement in agents. Its inputs were the round number, the champion's id, the model server's concurrency, and optional extra candidates or forced finalists (used to rematch two former champions after a measurement change). It returned the decision and the analyst's summary to the orchestrating session, which reviewed them, applied proposals and launched the next round.

Every agent's prompt starts the same way: you are one agent in an unattended prompt-optimization loop; read the operating manual (commands, gates, promotion rule) and the standing directions first. Then each role gets its brief:

- **Proposer**: read the insights, backlog, journal, leaderboard, proposals and latest results; render a few of the champion's worst walkthroughs and read their judge notes; write the variants, mixing at least one bold structural idea with at least one small fix for the champion's most frequent failure; don't retry an idea the journal shows failed unless something material changed; check each with a prompt dump and one smoke run, deleting broken ones; mark the backlog items used; return each candidate's id, hypothesis and target cases.
- **Runner**: run the given commands exactly and change nothing; resume an interrupted run command instead of restarting it; never run two at once; before returning, count the run files against cases × runs and report whether anything is missing. The workflow re-dispatches a fresh runner, up to three times, until it reports complete.
- **Judge**: read the rubric once, then judge every packet in one batch folder that has no result yet, each independently and against its gold; never open the manifest, the runs or the variants.
- **Pairwise judge**: the same, with the pairwise rubric.
- **Decider**: ingest the judgments (judging any stragglers itself), aggregate, apply the promotion rule and gates exactly, promote at most one finalist, and append a journal entry: candidates and hypotheses, screen and dev tables, routing, pairwise, the decision with the rule that decided it, and a paragraph of lessons.
- **Analyst**: find where the newest walkthroughs still fail, and whether the judges and metrics measure the right thing; record durable lessons with case and variant ids, re-rank the backlog with 3–6 new evidence-backed ideas, add up to 3 cases where the suite has a blind spot, and write measurement proposals for the orchestrator.

The variant contract made agents' work composable: one file per variant, named by its id; a variant wraps its parent and changes one thing; its notes state the parent, the hypothesis and the exact change; a variant with results is never edited, only superseded.

Runner agents used a small, fast model at low effort; proposers, judges, deciders and analysts used the strongest model. Judges ran in parallel, about ten packets each. The champion's earlier runs were reused, so a round only generated new candidates' runs, plus whatever stale judgments needed redoing.

Between rounds, the orchestrator:

- applied or rejected the analyst's proposals;
- redid the champion's runs after a listener or runner change;
- overrode a promotion when fidelity said otherwise;
- updated the standing directions with the product owner's answers;
- gave the product owner a short check-in after each round, and a fuller review when the priorities themselves needed confirming.

## The measurement keeps evolving

The rubric, the scripted listener, the metrics, the gates, the cases and the loop itself are not fixed. Every campaign so far found edge cases where the instrument rewarded the wrong thing or missed a failure, and fixing those mattered as much as tuning the prompt. Treat the measurement as something you keep upgrading, the same way the preset is.

When a judge note, a flag, an analyst finding or your own reading of a walkthrough shows the measurement is off:

1. Write it up with evidence (case ids, counts); the loop's analyst does this each round.
2. Apply it deliberately between rounds, never mid-comparison. Bump the rubric version so stale judgments are re-judged; after a listener or runner change, redo the champion's runs; add new cases to `dev`, never to `screen` or `heldout`.
3. Record the change in the table below with the edge case that prompted it.
4. Don't compare numbers across a change: re-baseline the champion first.

| Change                                                                                                                               | Edge case that prompted it                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Runner keeps the actions that closed and retries once on a broken reply                                                              | A stray quote under enforced JSON ended runs early; production does the same retry                                        |
| Runner redoes runs that ended in provider errors; runners verify their counts                                                        | A server restart and a runner that stopped early left gaps that were silently judged or skipped                           |
| Worker replies kept as their real message list                                                                                       | Multi-message replies lost their boundaries, hiding interim notes the voice skipped                                       |
| Listener v2: realistic answer per gold question, one deferral per case, stricter Continue detection, cap scales with questions       | "I'd go with what you recommend" on every question and first-option picks distorted results                               |
| Listener v3: no in-order fallback; invented approval questions get a plain yes; matches recorded                                     | Invented questions received real answers, so the real questions were never asked                                          |
| Rubric v1.1: reactions, "that's settled" declarations, invented option descriptions and promises after forwarding count as additions | Judges counted these inconsistently                                                                                       |
| Rubric v1.2: a question shown in the same response as the forward counts as missing                                                  | The listener could never answer it, yet it was credited                                                                   |
| Rubric v1.3: grading the listener's answer is an addition; screens score real compression; narration not scored                      | "Exactly right!" passed; same-length rewording scored as compression                                                      |
| Rubric v1.4: points scored first; screens and burden capped when compression drops content; invitations need an ask                  | A tight screen budget scored +5 while losing content                                                                      |
| Rubric v1.6: speech introduces each screen, then gives its highlights; reading parts of the screen is fine, explaining is not        | Listening live, the product owner still read every screen in full: one orienting line per screen did not lower the effort |
| Rubric v1.5: each question needs its own answer slot; questions asked where they come up                                             | "What are your answers to these six?" was credited for all six                                                            |
| Recall gates and a pairwise fidelity veto                                                                                            | The composite promoted a variant that lost content                                                                        |
| Judge-free answered share as a gate                                                                                                  | Judges and the listener disagreed on which questions were really asked                                                    |
| Case-clustered, seeded bootstrap                                                                                                     | Runs of one case fail together; unseeded intervals moved between invocations                                              |
| Recall pre-gate at screen; candidates also screened on their target cases                                                            | Full runs were spent on candidates already losing content; targets were never measured                                    |
| Clean forward excludes holds that keep presenting or decide; agreement-only interrupts dropped; plain-agreement cases added          | "Got it. Next up…" passed as a forward; the product owner never interrupts just to agree                                  |
| Latency gate removed                                                                                                                 | Not a priority for now (product owner)                                                                                    |

## What worked and what didn't

Worked:

- **Blind judges scoring against gold**, point by point and question by question, with the rubric versioned.
- **Two instruments that disagree usefully**: the composite and blind pairwise caught each other's mistakes.
- **Judge-free proxies** (answered, goldCov, copy, compr) as gates and as a cheap check when judging was not possible.
- **Fresh agents per round with plain-file state**: no agent's context had to survive the campaign, and the analyst's measurement findings drove most fixes.
- **Screen small, decide on `dev`, confirm on `heldout`**, and a frontier model on the same prompt as a ceiling.

Didn't:

- **The composite alone**: a screen word cap scored +5 while losing content. Fidelity needs hard gates.
- **Trusting small screens**: gains of +6 to +8 on 8 cases shrank to under +1 on `dev`, and nine rounds of dev gains summed to about +11 but held out at +2.7.
- **Gates relative to the current champion**: screen copying crept from 0.44 to 0.56 across promotions, each step inside the limit. Next time, also cap absolute values.
- **The first scripted listener and the first rubric**: both rewarded the wrong behaviour until edge cases surfaced (the table above). Expect to fix the instrument early in every campaign.
- **One run per routing case**, and an unseeded bootstrap: results flipped by chance.

## Rebuilding it

Hand a coding agent this document and the rubrics, and ask for:

- A runner beside the packages that renders prompts with Core's own history rendering and the preset under test, so the model sees exactly what production sends; a streamed Chat Completions client with a JSON-schema response format for the voice model; and, for frontier probes, a client using the backend's ChatGPT sign-in.
- The run loop, scripted listener, metrics and composite exactly as specified above.
- Scripts to build blind judging packets in batches, ingest the judges' JSON with its rubric version, aggregate with the bootstrap, and run pairwise comparisons; plus a renderer that prints a run as the listener experiences it.
- One workflow per round, as in the table above, with runners that verify their counts.

Constraints that cost us time:

- **vLLM** must run with structured-output whitespace disabled (`disable_any_whitespace`). Without it, a stray quote inside enforced JSON turns into thousands of spaces.
- **Respect the server's capacity**: total concurrency within its limit (ours took 3), one run command at a time, and each case's responses back to back so the prefix cache is reused.
- **Runs must be complete before judging**; resume rather than restart, and redo runs that ended in provider errors.
- **Keep private data out of the repository**: cases, gold, runs, packets and campaign state.
