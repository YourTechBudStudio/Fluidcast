# Cases and gold

Case and gold files hold text from real sessions, so they are gitignored; only `sets.json` (which case ids form which set) is shared. `lib/data.ts` loads `candidate-cases.jsonl`, every `extra-*.jsonl` and every `gold-*.jsonl` in this folder.

## Case files

`candidate-cases.jsonl` and `extra-*.jsonl`, one JSON object per line:

| Field              | Meaning                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | Unique id, used in `sets.json` and run file names                                                                                               |
| `category`         | Free label (short answer, many questions, tradeoff table, routing…)                                                                             |
| `contextSummary`   | One or two lines of session context, shown to judges                                                                                            |
| `priorUserMessage` | The listener's message the worker answered                                                                                                      |
| `workerReply`      | The worker's reply as one string                                                                                                                |
| `workerMessages`   | The same reply as the worker's top-level messages, in order (joined with a blank line, they equal `workerReply`); the forward result uses these |
| `preamble`         | Optional earlier actions, for late-session cases                                                                                                |
| `interrupt`        | Optional `{ atStep, text }`: interrupt at that response instead of answering                                                                    |
| `agree`            | Optional `{ atStep, text }`: a plain typed agreement instead of pressing Continue                                                               |

Cases were mined from Claude Code transcripts: design-style sessions, one worker turn per case (the text messages after the turn's last tool call), chosen for variety (short answers, many questions, tradeoff tables, code, diagrams, status reports, replies after pushback or confusion, multi-message turns).

## Gold files

`gold-*.jsonl`, one object per case id, written once per case by a strong model and spot-checked:

- `points`: atomic claims, each `{ id, text, weight }`, where `weight` is `core` (needed to follow the work or decide), `detail`, or `narration` (the worker's process narration, not scored).
- `questions`: everything the worker asks the listener, including offers and soft invitations, each `{ id, text, options, recommended, kind, answer, pick, defer }`. `kind` is `decision`, `check`, `quiz`, `offer` or `info`; `answer` and `pick` are what the scripted listener says; `defer: true` marks at most one question per case that gets "I'd go with what you recommend."
- `verbatim`: text meant to be used exactly as written.
- `quiz` and `gist`: a few comprehension questions and a one-line summary.

Routing cases (`interrupt` or `agree`) need no gold.

## Sets

`sets.json` names the sets the scripts accept (`--cases screen`, or a mix such as `--cases screen,case-04`): `screen` (8 diverse cases for quick checks), `dev` (the main comparison set), `heldout` (never used for tuning), `routing-other` (redirect interrupts), `continue-agree` (plain agreements), and `routing` (both).
