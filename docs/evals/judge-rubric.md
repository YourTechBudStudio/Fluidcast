# Judging a Fluidcast drive walkthrough (rubric v1.6)

## What Fluidcast is for

A developer works with a coding agent (the "worker") through Fluidcast instead of reading the agent's long replies. A small voice model (the "voice") takes each worker reply and walks the listener through it **in the first person, as if it were the worker**, one segment at a time: it speaks a little and puts compact material on screen (Markdown or Mermaid). After each segment it pauses until the listener continues. The worker's questions become the voice's questions, asked on screen. After the last segment the voice hands everything back to the worker with `forward`.

The job to be done: **the listener ends up understanding everything the worker meant, and answering every question it asked, with less effort than reading the reply, without being much slower, and while staying engaged.** Speech earns its time by sparing the reading: it introduces each screen, then gives its highlights in screen order so the listener only skims the screen; the screen holds the material, and the screen must be meaningfully easier to take in than the raw reply (compressed, structured, visual), not a copy of it.

## What you get

- The worker's original reply (what the listener would otherwise read).
- The gold reference: atomic points (`core` or `detail`), the worker's questions, verbatim items, gist.
- The walkthrough transcript: `VOICE:` lines are spoken aloud; `SCREEN` blocks are what is on screen (each replaces the previous); `QUESTION` is an on-screen question; `LISTENER` lines are the scripted listener (it always presses Continue or answers questions generically: ignore the quality of its answers); `[FORWARD to the work]` hands the conversation back.

## What to ignore

The voice's personality and phrasing as long as meaning holds (fillers like "good news", "got it", light enthusiasm are fine); TTS concerns; the scripted listener's answers; minor Markdown style.

## Scores

Score from the listener's point of view. Use the full range; 3 is "fine, nothing special". Score `points` and `questions` first; the presentation scores (burden, screens, pacing, speed) must respect them: if a point you marked missing or distorted sat in a section the screens compressed, `screens` is at most 3 for a core point and at most 4 for two or more detail points, and `burden` at most 4. Compression that drops content is not compression.

1. **points** — For each gold point, decide `conveyed` (meaning reached the listener through speech or screen, possibly compressed), `missing`, or `distorted` (conveyed with changed meaning: wrong number, flipped recommendation, a decision presented as made when it was open, etc.). Compression is fine; dropping a point is not.
2. **questions** — For each gold question: `asked` (put to the listener with its own way to answer: its own `ask`, or its own option group, with its options if it had any; a catch-all ask covering several questions at once, such as 'your answers to these six?' or 'do you agree with all three?', does not count for any of them), `spoken_only` (only said aloud, never on screen), `missing`, or `distorted`. A question put on screen in the same response as `[FORWARD to the work]` counts as `missing`: the listener can never answer it. A worker line that invites a reply without being a question ("push back if you disagree", "say the word if you'd rather…", an offer) counts as `asked` only when it is put to the listener with a way to answer (an `ask`); said or shown before a bare Continue it is `spoken_only`.
3. **additions** — List claims the voice added that are not in the reply: its own opinions, recommendations, decisions, agreements, facts, or questions the worker didn't ask. Personality filler is not an addition: a neutral acknowledgement ("got it", "okay") is filler. Declaring the listener's answer a settled decision ("that's locked"), interpreting it, inventing option descriptions or trade-offs the worker didn't give, or promising future work in the line after `forward` are additions. Telling the listener their answer to the worker's check or quiz question is right or wrong ("Exactly right", "You're close"), or explaining the answer, is an addition: the worker grades, not the voice. Relaying the worker's own judgement of an earlier answer is not grading (it is content: leaving it out is a missing point). Points marked `narration` in the gold are the worker's process narration: the voice may skip them; don't score them.
4. **burden** (1–5) — How easy was it to take in? 5 = one idea at a time, each segment digestible at a glance, screens compressed and well structured, speech tells you what to look at, never overwhelmed. 1 = walls of text, dumps, confusing order, screens that are the raw reply pasted.
5. **screens** (1–5) — Do screens add meaningful value over the raw text? 5 = genuinely easier than reading the original: each section carried in clearly fewer words (about half or less) without losing a point, tables for comparisons, diagrams for flows/structures, key terms highlighted. 3 = reworded at about the same length (paraphrase is not compression). 1–2 = verbatim copies, pasted tables/prose, or noisy fragments.
6. **speech** (1–5) — 5 = natural, first person, introduces each screen in a line, then gives its highlights in screen order, about one short sentence per block, so the listener can skim the screen; reading parts of the screen aloud is fine; no explaining beyond the reply, no code/paths spoken, no padding. 1 = only names the section (the listener must read everything), retells the screen at length or explains it, robotic, or third person ("the agent says").
7. **pacing** (1–5) — Are segment boundaries sensible? 5 = each segment one coherent idea, the right number of segments for the reply's size, each question asked in or right after the segment it depends on, no dumping of several sections after a Continue, no needless micro-segments.
8. **speed** (1–5) — Compared with reading the original reply, how fast does this get the listener to understanding? 5 = as fast or faster than reading; 3 = somewhat slower but worth it; 1 = much slower (speech that retells instead of highlighting, many near-empty steps).
9. **engagement** (1–5) — Would a tired developer stay attentive? 5 = feels like a sharp colleague talking you through it, varied rhythm, clear stakes; 1 = monotone, list-reading, or chatter.
10. **overall** (0–10) — Would the listener prefer this over reading the reply? 10 = clearly better: understood everything with less effort; 5 = a wash; 0 = worse than reading (lost meaning, confusing, or exhausting). Fidelity problems (missing core points, missing questions, distortions, additions) cap overall: a missing core point or question caps at 6, a distortion or invented decision caps at 4.
11. **flags** — Short tags for notable problems, from: `dump`, `screen_copy`, `no_highlights` (speech after a screen does not give its key points), `third_person`, `forward_early`, `no_forward`, `missing_question`, `added_opinion`, `graded_answer` (tells the listener their answer is right/wrong or explains it), `question_without_setup` (a worker question asked without what its answer depends on: the options' trade-offs, which option is today's design, the example it refers to), `headline_buried` (the reply's headline or status, e.g. blocked/failed/done/restart needed, not stated first), `gave_away_answer` (screen or speech states a quiz question's conclusion before or alongside asking it), `answered_after_deferral` (answers or recommends after the listener defers), `too_many_segments`, `too_few_segments`, `wall_of_text`, `jargon_spoken`, `bad_mermaid`, `repetition`, `lost_order`, `other:<short>`.
12. **notes** — Two or three sentences: the most important thing that worked and the most important thing that didn't.

## Output

Write exactly this JSON (no prose around it) to the path you were given:

```json
{
  "points": { "p1": "conveyed", "p2": "missing" },
  "questions": { "q1": "asked" },
  "additions": ["..."],
  "burden": 4,
  "screens": 3,
  "speech": 4,
  "pacing": 4,
  "speed": 3,
  "engagement": 4,
  "overall": 7,
  "flags": ["screen_copy"],
  "notes": "..."
}
```
