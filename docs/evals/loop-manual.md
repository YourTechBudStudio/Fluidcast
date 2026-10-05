# Fluidcast drive-mode hill-climb: operating manual

Every agent in this loop reads this file first. Working directory for all commands: `docs/evals` in the Fluidcast repository. How a person runs the loop is in [README.md](README.md).

## Goal

Optimize the **prompting** of Fluidcast's voice model (Qwen3.8-27B, alias `qwen`, medium reasoning, temperature 0.3, server-enforced JSON) for **drive mode**:

- The voice is always paired with one worker (a coding agent such as Claude Code). It speaks the worker's work **in the first person**, as if it did the thinking.
- When a worker reply (`forward` result) arrives, the voice splits it into segments **itself** (no code-side splitting, no instructions to the worker about format) and presents **one segment per response**: brief speech to orient, compact screens (`show`, Markdown or Mermaid) to carry the material. Then it pauses (a Continue `ask`, or the worker's questions as `ask`s).
- Non-interrupt listener input (Continue, answers) means "keep going". The voice never answers anything itself.
- An **interrupt** means "forward now": `forward` first, then one holding line.
- After the last segment and its questions, the voice writes `forward` once; the whole transcript (answers included) goes to the worker.

What we optimize, in priority order: (1) **fidelity**: no point or worker question lost, distorted or invented; (2) **cognitive burden**: one idea at a time, screens that compress meaningfully (not copies), speech that orients and doesn't read the screen; (3) **speed** vs. reading the raw reply (speech is slow; it must earn its time), and model latency per segment; (4) **engagement**. We ignore Qwen's personality and phrasing as long as meaning holds, TTS, HTML shows, and the listener-to-worker direction (forward ships the whole transcript).

## What you may change (the optimization surface)

Only prompting: the system prompt text (role, rules, style), tool guidelines (keep them brief), worked examples, per-event reminders (after a forward result, a Continue, an answer, an interrupt, a new message), the speaker profile (`Variant.speaker`: name and personality; the id stays `host`), how the forward result is framed (but **no splitting of the worker's reply into parts in code**; a short header or a framing line is fine), the pause representation (`ask` Continue vs. natural stop + "Continue." message), structured output on/off, temperature and reasoning effort (keep medium unless testing it explicitly). Reminders are the strongest lever: Qwen respects the newest user-role content most. Reminders must be computable by a harness from the newest input alone (its type, the tool, whether it was a Continue, an answer or an interrupt); a reminder may also use simple counts a harness could track (`DriveState`: step, segments so far), but say so in the variant notes because it implies harness work.

Never edit anything outside `docs/evals` (no `packages/`, no `apps/`); within it, campaign files go in `out/`, `judging/` and `state/`, and new variants in `variants/gen/`. Never run `pnpm dev`/`start`. Never run state-changing git commands.

## Layout

- Scripted listener v3 (from round 4; v2 in round 3): no in-order fallback — an ask that matches no gold question (similarity < 0.25, or < 0.12 for non-approval asks) is a question the worker never asked: approval-shaped ones ("does that work for you?") get "Sure, that works.", others "No strong opinion on that one.". `sim.match` in each step records the matched gold question ids (`none`, `none:approval`, `continue`). Otherwise as v2: a Continue is an ask with ≤ 2 options, one saying continue, and a readiness question (or a single Continue option); any other ask is a question, answered with the matched gold question's realistic `answer`/`pick` (one gold-marked question per case at most gets the deferral "I'd go with what you recommend."); unmatched questions get "No strong opinion on that one.". The step cap is 12 + the case's gold question count.
- `lib/` runner internals: `model.ts` (Qwen and SOL clients), `prompt.ts` (tools, Core's real history rendering), `drive.ts` (drive loop + scripted listener), `metrics.ts`, `render.ts`, `data.ts`.
- `variants/blocks.ts` building blocks (drive generation 1: `d1Ask`, `driveRole`, `driveSystem`, `driveTools`, `driveExample`, `routingExamples`, `d1Text` reminders, …); `variants/common.ts` (`driveReminders`, production pieces); `variants/index.ts` registry. **New variants go in `variants/gen/<id>.ts`**, default-exporting a `Variant` whose `id` equals the file name (template: `variants/gen/_example.ts.txt`). Variant files are immutable once they have results; make a new id instead.
- `cases/` `candidate-cases.jsonl` (real worker replies mined from the user's sessions; private, gitignored), `extra-*.jsonl` (added cases, e.g. `extra-routing.jsonl` with scripted interrupts), `gold-*.jsonl` (gold points/questions/quiz per case), `sets.json` (`screen` 8 cases, `dev` 27, `heldout` 11 — never run heldout unless the orchestrator says so, `routing` 8 interrupt cases).
- `out/<tag>/<model>/<variant>/<case>.r<rep>.json` runs; `.judge.json` beside each once judged. Tags: `screen` for screening, `dev` for full runs. Reuse: the runner skips runs that exist, so the champion's runs are shared across rounds.
- `judging/<name>/` packets for judges; `judge-rubric.md` (absolute rubric) and `pairwise-rubric.md`.
- `directions.md` (the user's standing directions: obey them). `state/` is the campaign's memory: `champion.json`, `leaderboard.md`, `journal.md`, `backlog.md`, `insights.md`, `proposals.md` (suggested changes to rubric/metrics/composite for the orchestrator).

## Commands

```bash
node show-prompt.ts <variant> [case-id]            # what the model sees (check every new variant!)
node run.ts --variants a,b --cases screen --reps 2 --conc 3 --tag screen
node run.ts --variants a,b --cases routing-agree --reps 5 --conc 3 --tag screen   # agreement-only interrupts (the hard class)
node run.ts --variants a,b --cases routing-other --reps 2 --conc 3 --tag screen   # case specs mix set names and ids: --cases screen,case-04
node lib/render.ts out/screen/qwen/<variant>/<case>.r1.json   # read a walkthrough
node judge-prep.ts --tag screen --variants a,b --batches 3 --name <name> [--cases screen]
node judge-ingest.ts --name <name>
node aggregate.ts --tag screen --variants base,a,b --baseline base [--cases screen] [--json state/results/<name>.json] [--perCase]
node pairwise.ts prep --tag dev --a champ --b cand --name <name> --batches 3 --cases dev
node pairwise.ts score --name <name>
```

Qwen capacity: set `--conc` to what the server takes in total (currently 3), and run **one** `run.ts` at a time. Each case's responses run back to back so the server's prefix cache is reused; tasks are ordered variant by variant. `run.ts` is resumable: if a Bash call times out, run the same command again until it prints `done:`. Use a Bash timeout of 600000 ms per call. Invalid output (e.g. the stray-quote whitespace runaway under constrained decoding) is handled like production: the runner keeps the actions that closed, records the failure, and retries once with a cut-off notice; two failures in a row end the run as `invalid`. The retry carries a harness-level failure reminder ("…quote with single quotes"), the same for every variant. SOL (`--model sol`) is expensive: only on the orchestrator's instruction.

## Scoring

`aggregate.ts` composite (0–100) per judged run: 25 fidelity (0.75 core recall + 0.25 detail recall), 15 question rate, 15 overall/10, 10 burden, 8 screens, 7 pacing, 7 speed, 5 speech, 5 engagement, 3 protocol, minus up to 15 for distortions/additions. Δ vs baseline is a paired bootstrap over shared (case, rep) runs. Judgments carry the rubric version they were made under; `judge-prep.ts` re-judges stale ones automatically, and the `stale` column must be 0 for every variant in a comparison. Deterministic columns: `ok` (ended properly), `segs`, `dump` (share of shows in the biggest response), `words/seg`, `time×` (estimated listen time / raw read time), `echo` (speech that repeats the screen), latency.

**Promotion rule** (full `dev` run, dev cases × 3 reps, plus `routing`): a candidate replaces the champion when its paired Δ composite > +1.0 with the lower bound of the **case-clustered** 90% interval (the first bracket in the Δ column; seeded, resamples cases with all their reps) > 0, **or** it wins the blind pairwise comparison with win rate ≥ 0.6 and wins more cases than it loses (per-case majority line), Δ ≥ 0, and no gate regression. Gates (vs champion): **core recall not lower by > 0.02; detail recall not lower by > 0.05** (fidelity is priority 1: compression must never buy its score with lost points); question rate not lower by > 0.03; **answered share** (`answered` column: gold questions the scripted listener actually got to answer, judge-free) not lower by > 0.03; distortions+additions per run not higher by > 0.15; ok rate ≥ 0.95; routing clean-forward on redirect interrupts (`routing-other`, the "others" figure in the routing line) not lower by > 0.1; continue-on-agreement rate (`continue-agree` cases; skip this gate if a variant has no such runs yet) not lower by > 0.1; mean `screenCopy` (copy column: share of screen 4-grams copied verbatim from the reply) not higher by > 0.05; mean `compr` (screen words ÷ reply words) not higher by > 0.05. **Fidelity veto:** even when the primary rule passes, do not promote if the blind pairwise win rate is < 0.45 and the pairwise judges call the candidate more faithful in < 40% of the decided pairs; record it as "promising, recall-deficient" instead. A tie that makes the prompt shorter or simpler may also be promoted (say why).

## Writing variants (for proposers)

- One hypothesis per variant, small and attributable. State parent, hypothesis, and the exact change in `notes`.
- Prefer reminders and examples over longer rules: with a small model, longer instructions measured worse. Keep tool guidelines brief.
- Qwen copies precedent: worked examples are powerful, and an example's topic or wording can leak.
- Check every new variant with `node show-prompt.ts <id>` and a single smoke run (`node run.ts --variants <id> --cases smoke --tag smoke --conc 1`) before handing it on; delete broken files.
- Read `state/insights.md` and `state/backlog.md` first; don't retry ideas the journal shows failed unless you change something material.

## Upgrading the measurement

The rubric, listener, metrics, gates, cases and process are expected to change as edge cases appear. Analysts propose changes with evidence in `state/proposals.md`; they are applied between rounds and recorded, with the edge case that prompted them, in the history table of [README.md](README.md#the-measurement-keeps-evolving).

## Writing to state

Append, don't rewrite history. `journal.md` entries: `## Round N — <date-less title>` with candidates, screen table, decision, and one paragraph of lessons. `leaderboard.md`: one line per variant evaluated on `dev` (id, composite, Δ vs the then-champion, verdict). `insights.md`: durable lessons about Qwen and the task (with evidence: variant ids). `backlog.md`: idea queue, highest value first, each with a one-line rationale; mark ideas `[tried rN]` when used.

## Changes from round 5

- Routing forward-first is a _clean_ forward: `forward` first and nothing shown or asked after it. Agreement-only interrupts (`routing-agree`, 6 cases) run at 5 reps, others (`routing-other`) at 2. Compare routing only within the same tag.
- Proposers name up to 3 target cases per candidate; the screen also runs those (2 reps). Advancement still uses the fixed `screen` set; the target Δ is reported beside it (aggregate with `--cases <targets>`).
- aggregate prints question recall by gold kind (offers have been 0% for every variant) and segments per 100 words on short replies (< 250 words).
- Frontier reference runs (GPT-6.1 SOL, GPT-6-LUNA, low effort, no enforced JSON) live under out/dev/sol and out/dev/luna (`--model sol|luna`).

## Changes from round 7 (user direction)

- Agreement-only interrupts are out of scope (the user never interrupts just to agree): `routing-agree` is no longer run or gated. Routing gates use redirect interrupts only (`routing-other`).
- New `continue-agree` cases: mid-walkthrough the listener types a plain agreement ("Sounds good", "Okay, that makes sense") instead of pressing Continue, not as an interrupt. The right response continues the walkthrough with the next segment (no `forward`); the metric is `continuedAfterAgreement`, printed in the routing line.

## Changes from round 8 (user-approved priorities)

- No latency gate (latency is still printed, but not judged or gated).
- New knob `tools.askOptionDescriptions: false`: ask options are bare `{label}` in the prompt types and the enforced JSON. Any variant may use it (`r8-x-nodesc` tests it alone on the champion).
- Offers count as questions. Short replies: no rule on pausing.

## Changes from round 9

- Rubric v1.5: a question is `asked` only with its own answer slot (catch-all asks count for none); pacing rewards asking each question in or right after its segment. pairwise-rubric.md: offers/invitations are worker questions.
- New gate: judge-free `answered` share (−0.03). New columns: answered, catchAll, inviteBehindCont.
- rt-x6-hold ("hold on a sec") moved to `routing-pause` (a pause, not a redirect; not gated). continue-agree runs at 1 rep (every variant is 1.00).
