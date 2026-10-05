# Evaluating voice behavior

This folder measures how well a preset makes the voice model walk a listener through worker replies, and runs an unattended loop that improves it. It produced the Guided Walkthrough preset; what it found is in [Guided walkthrough prompting](../research/guided-walkthrough-prompting.md), and the preset itself is described in [Presets and instructions](../product/presets.md).

## What is measured

A good walkthrough gets every point and question of the worker's reply to the listener, with less effort than reading the reply, without being much slower, and engagingly. In priority order:

1. **Fidelity**: nothing lost, distorted or invented (gold points and questions, checked by judges and by a judge-free coverage count).
2. **Cognitive burden**: one idea at a time, screens that compress, speech that orients instead of reading the screen.
3. **Speed** against reading the raw reply.
4. **Engagement**.

Routing is a pass/fail check: an interrupt is forwarded first with one neutral line; a plain agreement keeps the walkthrough going. Model latency and the voice's personality are not judged.

## Layout

```text
docs/evals/
├── README.md               # this file
├── loop-manual.md          # the operating manual every loop agent reads (commands, gates, promotion rule)
├── judge-rubric.md         # absolute rubric (versioned: judgments carry the version they were made under)
├── pairwise-rubric.md      # blind A/B rubric
├── directions.md           # standing directions for the loop, in the product owner's words
├── round.workflow.js       # one hill-climb round, as a Claude Code workflow
├── run.ts                  # drives variants through cases
├── judge-prep.ts / judge-ingest.ts / pairwise.ts / aggregate.ts / show-prompt.ts
├── lib/                    # runner: model clients, prompt assembly, drive loop, scripted listener, metrics
├── variants/               # building blocks; gen/ holds one file per variant
└── cases/                  # sets.json is shared; case and gold files are private (see cases/README.md)
```

`out/`, `judging/` and `state/` are created per campaign and are gitignored, like the case data.

## Setup

1. Link the backend's dependencies once: `ln -s ../../apps/backend/node_modules docs/evals/node_modules`.
2. Put the voice model's endpoint in the environment or the repository's `.env`: `FLUIDCAST_EVAL_BASE_URL` (a Chat Completions `/v1` URL), `FLUIDCAST_EVAL_MODEL` (default `qwen`) and `FLUIDCAST_LLM_API_KEY`. For vLLM, start the server with structured-output whitespace disabled (`disable_any_whitespace`): without it, a stray quote inside enforced JSON turns into an endless run of spaces.
3. Frontier reference models (`--model sol` or `--model luna`) use the backend's ChatGPT sign-in (`pnpm chatgpt:login`).
4. Supply cases and gold in `cases/` (format in [cases/README.md](cases/README.md)).

Run every command from `docs/evals`.

## How one run works

A run seeds a conversation that ends with a worker reply arriving, then lets the voice walk through it, one response at a time, against a scripted listener:

```text
seed: listener message → forward → worker reply (the case)
loop:
  render the prompt with Core's own history rendering and the variant's reminder for the newest input
  generate (enforced JSON); keep the actions; on a broken reply, keep what closed and retry once
  forward written            → done
  asks open                  → the listener answers: Continue, the gold answer for the matched question,
                               one scripted deferral per case at most, or a neutral reply to invented questions
  nothing to ask, no screens → done
  otherwise                  → the listener says "Continue."
```

Routing cases replace one listener input with an interrupt (`interrupt`) or a plain agreement (`agree`) and stop after the response to it. `node lib/render.ts <run.json>` prints a run as the listener experiences it.

## A quick comparison

This is how a small change was checked after the loop ended (for example, renaming the forward tool):

1. Write the variant as `variants/gen/<id>.ts`, default-exporting a `Variant` whose `id` matches the file name. Wrap an existing variant and change only what you are testing.
2. Check what the model sees: `node show-prompt.ts <id> [case-id]`.
3. Run it beside the baseline (existing runs are reused): `node run.ts --variants base,<id> --cases screen --reps 2 --conc 3 --tag screen`, then the routing sets: `--cases routing-other --reps 2` and `--cases continue-agree --reps 1`.
4. Build blind packets: `node judge-prep.ts --tag screen --variants base,<id> --batches 4 --name <name> --cases screen`.
5. Have judges score them: in Claude Code, ask for one agent per `judging/<name>/batch-N/` folder that reads `judge-rubric.md` and writes `<packet>.json` beside each packet. Judges must not open the manifest, `out/` or variant files.
6. `node judge-ingest.ts --name <name>`, then `node aggregate.ts --tag screen --variants base,<id> --baseline base --cases screen` and `--cases routing`.

Read the Δ with its interval: on the 8 screen cases × 2 runs, differences under about 4 composite points are noise. Decide on the full `dev` set (3 runs per case) and confirm on `heldout` only at milestones.

## Scoring and promotion

`aggregate.ts` reports a composite (0–100): fidelity 40 (points 25, questions 15), the judges' overall 15, presentation 37 (burden, screens, pacing, speed, speech), engagement 5 and protocol 3, minus up to 15 for distortions and additions. Δ against a baseline is a paired, seeded bootstrap that resamples cases with all their runs, because runs of one case fail together. Many diagnostic columns sit beside it: the judge-free `answered` share and `goldCov`, `copy` and `compr` for screens, routing rates.

A candidate replaces the champion only if it gains on the composite with the interval above zero, or wins the blind pairwise comparison, **and** passes every gate: recall, questions, invented content, screen copying and length, and routing may not regress beyond set limits. The pairwise judges can veto a promotion on faithfulness. The exact numbers are in [loop-manual.md](loop-manual.md).

## The unattended loop

`round.workflow.js` runs one round with fresh agents. Pass `args.dir` (the absolute path of this folder), `args.round` and `args.champion`, and optionally `args.conc` (default 3).

| Phase        | Agents                | What happens                                                                                                                                                    |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Propose      | 1                     | Reads the journal, insights, backlog and real failures; writes 3–4 variants, each one hypothesis, smoke-tested                                                  |
| Screen       | 1 runner              | Runs candidates on the 8 screen cases, their target cases and the routing cases                                                                                 |
| Judge screen | ~10                   | Blind absolute judging                                                                                                                                          |
| Select       | 1 runner              | Aggregates; candidates within a point of the champion that pass the recall pre-gate go on                                                                       |
| Full run     | 1 runner              | Finalists on the `dev` set (3 runs per case) and routing; the runner verifies counts and is re-dispatched if short                                              |
| Judge full   | ~12 + ~6 per finalist | Absolute judging and blind pairwise against the champion                                                                                                        |
| Decide       | 1                     | Applies the promotion rule; updates `state/champion.json`, leaderboard and journal                                                                              |
| Analyze      | 1                     | Finds what still fails and whether the metrics measure the right thing; updates insights and backlog, may add cases, writes suggestions to `state/proposals.md` |

A round takes about 1.5–3 hours. Between rounds, a person (or the orchestrating session) reviews `state/proposals.md`, applies rubric or metric changes deliberately, and starts the next round. Before a campaign, create `state/` with an empty journal, leaderboard, backlog, insights and proposals, and `champion.json` naming the starting variant.

## The measurement keeps evolving

The rubric, the scripted listener, the metrics, the gates, the cases and the loop itself are not fixed. Every campaign so far found edge cases where the instrument rewarded the wrong thing or missed a failure, and fixing those mattered as much as tuning the prompt. Treat the measurement as something you keep upgrading, the same way the preset is.

When a judge note, a flag, an analyst finding or your own reading of a walkthrough shows the measurement is off:

1. Write it up with evidence (case ids, counts) in `state/proposals.md`; the loop's analyst does this each round.
2. Apply it deliberately between rounds, never mid-comparison. Bump the version in `judge-rubric.md`'s title so stale judgments are re-judged; after a listener or runner change, archive the champion's runs so they are redone; add new cases with gold to `dev`, never to `screen` or `heldout`.
3. Record the change in the table below with the edge case that prompted it.
4. Don't compare numbers across a change: re-baseline the champion first.

| Change                                                                                                                               | Edge case that prompted it                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Runner keeps the actions that closed and retries once on a broken reply                                                              | A stray quote under enforced JSON ended runs early; production does the same retry              |
| Runner redoes runs that ended in provider errors; workflow runners verify their counts                                               | A server restart and a runner that stopped early left gaps that were silently judged or skipped |
| Worker replies kept as their real message list                                                                                       | Multi-message replies lost their boundaries, hiding interim notes the voice skipped             |
| Listener v2: realistic answer per gold question, one deferral per case, stricter Continue detection, cap scales with questions       | "I'd go with what you recommend" on every question and first-option picks distorted results     |
| Listener v3: no in-order fallback; invented approval questions get a plain yes; matches recorded                                     | Invented questions received real answers, so the real questions were never asked                |
| Rubric v1.1: reactions, "that's settled" declarations, invented option descriptions and promises after forwarding count as additions | Judges counted these inconsistently                                                             |
| Rubric v1.2: a question shown in the same response as the forward counts as missing                                                  | The listener could never answer it, yet it was credited                                         |
| Rubric v1.3: grading the listener's answer is an addition; screens score real compression; narration not scored                      | "Exactly right!" passed; same-length rewording scored as compression                            |
| Rubric v1.4: points scored first; screens and burden capped when compression drops content; invitations need an ask                  | A tight screen budget scored +5 while losing content                                            |
| Rubric v1.5: each question needs its own answer slot; questions asked where they come up                                             | "What are your answers to these six?" was credited for all six                                  |
| Recall gates and a pairwise fidelity veto                                                                                            | The composite promoted a variant that lost content                                              |
| Judge-free answered share as a gate                                                                                                  | Judges and the listener disagreed on which questions were really asked                          |
| Case-clustered, seeded bootstrap                                                                                                     | Runs of one case fail together; unseeded intervals moved between invocations                    |
| Recall pre-gate at screen; candidates also screened on their target cases                                                            | Full runs were spent on candidates already losing content; targets were never measured          |
| Clean forward excludes holds that keep presenting or decide; agreement-only interrupts dropped; plain-agreement cases added          | "Got it. Next up…" passed as a forward; the product owner never interrupts just to agree        |
| Latency gate removed                                                                                                                 | Not a priority for now (product owner)                                                          |

## Lessons for running it

- **Check the measurement before trusting a gain.** The scripted listener needed three versions and the rubric six; each fix changed rankings (see the table above). Judgments are stamped with the rubric version, and `judge-prep.ts` re-judges stale ones.
- **The composite can be gamed.** A screen word cap scored +5 while losing content; recall gates and the pairwise veto exist because of it.
- **Small screens overstate gains.** Advance on the screen set, decide on `dev`, confirm on `heldout`.
- **Respect the server.** Keep total concurrency within the model server's capacity, run one `run.ts` at a time, and let each case's responses run back to back so the prefix cache is reused.
- **Runs must be complete before judging.** A runner that stops early leaves judges nothing; `run.ts` resumes, redoes runs that ended in provider errors, and the workflow re-dispatches incomplete runners.
- **Keep private data out.** Cases come from real sessions; they, the runs, the judging packets and the campaign state stay gitignored.
