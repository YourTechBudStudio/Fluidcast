/**
 * Deterministic metrics for one run: protocol, pacing, size, estimated consumption time and
 * latency. Judges cover meaning; these cover what code can count.
 */
import type { Case, Run } from './drive.ts';

export type RunMetrics = {
  ok: boolean;
  end: Run['end'];
  responses: number;
  invalid: number;
  segments: number;
  shows: number;
  maxShowsPerResponse: number;
  /** Share of all shows in the biggest response: 1 = everything dumped at once. */
  dumpIndex: number;
  /** Responses before the end whose last action is not an `ask` (ask-pause compliance). */
  pausesWithoutAsk: number;
  continueAsks: number;
  questionAsks: number;
  /** A show directly after a show, with no speech between. */
  backToBackShows: number;
  /** The final forward was not the first action of its response. */
  forwardNotFirst: boolean;
  /** Forward happened before the walkthrough presented anything. */
  forwardedEarly: boolean;
  spokenWords: number;
  spokenWordsPerSegment: number;
  showWords: number;
  rawWords: number;
  /** Estimated seconds: speech at 160 wpm, screens read at 240 wpm, mermaid nodes 1.2 s each. */
  listenSeconds: number;
  rawReadSeconds: number;
  timeRatio: number;
  /** Fraction of spoken word-trigrams that also appear on a screen (reading the screen out). */
  screenEcho: number;
  /** Code-ish tokens in speech: paths, backticks, camelCase/snake_case identifiers. */
  spokenJargon: number;
  firstActionSec: number;
  medianFirstActionSec: number;
  meanResponseSec: number;
  reasoningTokens: number;
  /** Share of screen word 4-grams that also occur in the worker's reply (1 = screens are pasted text). Additive diagnostic, not in the composite. */
  screenCopy: number;
  /** Screen words / reply words. Additive diagnostic. */
  showCompression: number;
  /** Share of distinctive words (>= 6 letters) from the reply's first 12% that appear anywhere in the walkthrough (speech, screens, asks). Proxy for a dropped opening/status line. Additive diagnostic. */
  headCoverage: number;
  /** Same for the reply's last 20%: proxy for dropped closing sections (run commands, next steps, offers). Additive diagnostic. */
  tailCoverage: number;
  /** Ask options that carry a `description` (a common vector for invented trade-offs). Additive diagnostic. */
  optionDescriptions: number;
  /** A response degenerated into a whitespace run (>= 200 chars), typically after an unescaped `"` inside a JSON string under constrained decoding. Additive diagnostic. */
  whitespaceRunaway: boolean;
  /** Question asks (not Continue) in the same response as the final `forward`: put to the listener but never answered. Additive diagnostic. */
  asksInForwardResponse: number;
  /** Responses with two or more question asks (not Continue) at once. Additive diagnostic. */
  multiQuestionResponses: number;
  /** Share of screen word 4-grams copied from the reply's prose only (outside tables, code fences and inline code), i.e. copying that the "keep verbatim" and "keep the table" rules don't excuse. Additive diagnostic. */
  proseCopy: number;
  /** Share of the reply's question sentences (ending in `?`, outside code) whose distinctive words mostly (>= 50%) appear in some ask: a judge-independent question-rate proxy. 1 when the reply asks nothing. Additive diagnostic. */
  replyQuestionCoverage: number;
  /** Spoken words after the final `forward` in the closing response (0 when the run did not forward). The final forward needs no holding line; this is where post-forward promises live. Additive diagnostic. */
  closingSpeechWords: number;
  /** The closing speech after the final `forward` promises or narrates future work ("let me…", "I'll…", "pull up", "get started"). Additive diagnostic. */
  closingPromise: boolean;
  /** Responses right after a listener answer whose first spoken sentence reacts to or settles it ("got it", "perfect", "X it is", "locked", "makes sense"). Rough regex proxy for the judge's answer-reaction additions. Additive diagnostic. */
  answerReactions: number;
  /** Highest per-response share of screen distinctive words (>= 6 letters, in responses whose screens hold >= 8 of them) found nowhere in the reply, the prior user message or the context summary. Proxy for screens with content the worker never wrote (e.g. invented 'stops' after a quiz). r3 dev: r = 0.43 with judge additions, -0.45 with overall; fabrication runs 0.66-0.68 vs median 0.14. Additive diagnostic. */
  maxScreenNovelty: number;
  /** Responses right after a listener answer whose speech makes or announces a choice for the listener ("I'll go with…", "I'll fill that in", "I'll pick…"). Proxy for answered_after_deferral and invented decisions, including after the neutral 'No strong opinion' answer. Additive diagnostic. */
  decisionAfterAnswer: number;
  /** Question asks shaped like an approval check of something the worker stated ("Does that work for you?", "Does X make sense?", "Sound right?"). Usually an invented question unless the worker asked for approval. Additive diagnostic. */
  approvalAsks: number;
  /** Routing cases: the response after the interrupt starts with `forward`. */
  interruptForwardFirst?: boolean;
  /** Routing cases: the response after the interrupt presents or answers (a show, or > 25 spoken words). */
  interruptAnswered?: boolean;
  /** continue-agree cases: the response after a plain (non-interrupt) agreement keeps walking through the reply. */
  continuedAfterAgreement?: boolean;
  /** Routing cases: shows and asks after the `forward` in the interrupt response, i.e. the voice forwarded and then kept presenting. `interruptForwardFirst` still counts these as passes. Additive diagnostic (r4 analyst). */
  interruptPostForwardContent?: number;
  /** Routing cases: the holding line after the interrupt's `forward` says the walkthrough goes on ("let me keep going", "next up", "pick up where we left off") or settles something before the work has seen it ("I'll go with my recommendation", "locking that in"). Additive diagnostic (r4 analyst). */
  interruptHoldMisleading?: boolean;
  /** Shows that list two or more questions (lines containing `?`). Usually all the worker's questions put on one screen and then asked again one by one; r4 dev: the judge's repetition flag is 0.28 of such runs vs 0.06 otherwise. Additive diagnostic (r4 analyst). */
  questionListShows: number;
  /** Question asks that ask the listener which topics or questions to take up ("Which one do you want to tackle first?", "Which of these do you have views on?") instead of asking the worker's questions; the listener then answers one and the rest are lost (case-04, case-13). Additive diagnostic (r4 analyst). */
  metaAsks: number;
  /** Share of the reply's prose sentences (code fences removed, >= 3 words of 5+ letters) whose content words, matched on their first 5 letters, appear at least half in the walkthrough (speech, screens, asks). A compression-tolerant recall proxy: unlike 4-gram copy or head/tail coverage it does not need the reply's wording, only its terms. r5 dev (33 cases × 3 reps): r = 0.59 with judge point recall within a case (r = 0.49 raw); r4-b 0.95, r5-a 0.94, r5-d 0.82 (judge recall 0.94 / 0.93 / 0.86). Additive diagnostic (r5 analyst); not in the composite. */
  sentenceCoverage: number;
  /** Question asks that bundle several of the worker's questions into one ask: options labelled with two or more question numbers ("1. Feel", "2. One voice", "3. OpenAI"), or a question inviting "any or all" / "whichever" answers. The listener answers one part and the rest are lost; `metaAsks` does not see these. r6 dev: r6-a 5/108 runs (case-17.r1/r3, case-01.r1, case-13.r2, case-16.r2), r4-b 1/108 (case-13.r1), r6-d 0/108. Additive diagnostic (r6 analyst); not in the composite. */
  bundledQuestionAsks: number;
  /** Responses whose speech or screens carry an offer or a soft invitation ("I can also…", "want me to…", "say the word", "tell me if you want…", "when you want them", "push back if…") while their only asks are Continues: the invitation is shown or said but never put to the listener (the judges' `spoken_only`). Regex proxy: it can fire on the voice's own "if you want to…" phrasing, so read it per variant, not per run. r8 dev, responses over 111 runs: r4-b 6, r8-x 8, r7-a 9, r8-b 11 (r8-b's precedent ends on a "Next" screen + "Ready to send your answer?" Continue; x5-devbuild 3/3). Additive diagnostic (r8 analyst); not in the composite. */
  invitationBehindContinue: number;
  /** Question asks (not Continue) that put several of the worker's questions to the listener at once as one catch-all ("What are your answers to these six?", "Answer whichever of those six you have views on", "Do you agree with all three?"). The judges mark every bundled question `asked`, but the scripted listener gives one neutral answer and the worker gets nothing per question (r8-x case-01.r2 composite 83 with all six questions answered "No strong opinion"). r8 dev asks over 111 runs: r4-b 2 (case-38.r1/r2), r8-x 2 (case-01.r2, case-17.r3), r7-a 2 (case-13.r2), r8-b 3 (case-01.r1, case-13.r1/r3). Complements `bundledQuestionAsks` (numbered options, "any or all"). Additive diagnostic (r8 analyst); not in the composite. */
  catchAllAsks: number;
  /** Screen 4-grams that appear in the listener's previous message but not in the worker's reply: the voice presenting what the listener pasted (a reviewer's or another agent's report) as the worker's own news. Run as a count of such 4-grams; 0 on almost every dev run (r9 dev max 6 per run for all three variants, because the dev prior messages are short questions), but 21 for both r9-b and r8-b on the r9 smoke of x9-usercall (tag smoke-r9-cases), where the listener pasted the design writer's status and the voice showed its artifact table and "Not verified: no code changed" as the worker's. `screenNovelty` counts the prior message as a reference, so it cannot see this. Additive diagnostic (r9 analyst); not in the composite. */
  priorMessageLeak: number;
};

/** Stems (first 5 letters of words of 5+ letters, numbers excluded) for coverage proxies. */
const stemSet = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 5 && !/^\d+$/.test(w))
      .map((w) => w.slice(0, 5)),
  );

/**
 * Gold-point coverage: the share of a case's gold points whose stems appear at least half in the walkthrough (speech, screens, asks with options). A judge-free recall estimate for runs that are not judged yet; needs the case's gold points, so `runMetrics` does not compute it. Calibration (r6 analyst; variant means vs judge point recall): r5 dev r4-b 0.945 vs 0.936, r5-a 0.933 vs 0.925, r5-d 0.821 vs 0.854; r6 screen (rubric v1.4) r4-b 0.957 vs 0.933, r6-a 0.872 vs 0.863, r6-b 0.868 vs 0.834, r6-c 0.875 vs 0.859, r6-d 0.827 vs 0.825. Run-level r with judge recall 0.50-0.93. Point level it is noisy (precision and recall about 0.5 at the 0.5 threshold) and it reads paraphrase as a miss, so use it for variant means, not single verdicts. Additive diagnostic; not in the composite.
 */
export const goldPointCoverage = (
  run: Run,
  points: ReadonlyArray<{ id: string; text: string; weight: string }>,
): { all: number; core: number; detail: number; missed: Array<string> } => {
  const text = run.steps
    .flatMap((s) => s.elements)
    .map((e) =>
      e.type === 'speak'
        ? String(e.text)
        : e.type === 'show'
          ? `${String(e.content ?? '')} ${String(e.title ?? '')}`
          : e.type === 'ask'
            ? `${String(e.question)} ${Array.isArray(e.options) ? (e.options as Array<{ label: string; description?: string }>).map((o) => `${o.label} ${o.description ?? ''}`).join(' ') : ''}`
            : '',
    )
    .join('\n');
  const walk = stemSet(text);
  const covered = (p: { text: string }) => {
    const s = [...stemSet(p.text)];
    return s.length === 0 || s.filter((w) => walk.has(w)).length / s.length >= 0.5;
  };
  const share = (ps: ReadonlyArray<{ text: string }>) =>
    ps.length === 0 ? 1 : ps.filter(covered).length / ps.length;
  return {
    all: share(points),
    core: share(points.filter((p) => p.weight === 'core')),
    detail: share(points.filter((p) => p.weight === 'detail')),
    missed: points.filter((p) => !covered(p)).map((p) => p.id),
  };
};

/**
 * Gold questions answered: the share of a case's gold questions that the scripted listener matched to an ask and answered with that question's realistic answer (`sim.match` in each step). A judge-free check on the judges' `asked` verdict: a question shown on a screen behind a Continue, folded into a catch-all ask ("What are your answers to these six?") or a merged "Do you agree with all three?" is judged `asked` but gets no answer of its own. r8 dev (111 runs per variant; pooled over questions / mean of runs): r4-b 0.831 / 0.885, r8-x 0.789 / 0.868, r7-a 0.828 / 0.881, r8-b 0.828 / 0.864, while the judged question rates are 0.94 / 0.94 / 0.92 / 0.91; 16–28 question verdicts per variant are `asked` without a listener match. A listener-similarity miss (score < 0.25) also reads as unanswered, so use it for variant means and to find runs to render. Additive diagnostic (r8 analyst); not in the composite.
 */
export const goldQuestionsAnswered = (
  run: Run,
  questionIds: ReadonlyArray<string>,
): { share: number; unanswered: Array<string> } => {
  const matched = new Set(
    run.steps.flatMap(
      (s) => ((s as { sim?: { match?: Array<string> } }).sim?.match ?? []) as Array<string>,
    ),
  );
  const unanswered = questionIds.filter((id) => !matched.has(id));
  return {
    share: questionIds.length === 0 ? 1 : 1 - unanswered.length / questionIds.length,
    unanswered,
  };
};

const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
const trigrams = (text: string) => {
  const t = norm(text);
  return new Set(t.slice(0, -2).map((_, i) => `${t[i]} ${t[i + 1]} ${t[i + 2]}`));
};
const median = (xs: Array<number>) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const jargonPattern =
  /(`[^`]+`)|(\b[\w-]+\/[\w./-]+)|(\b[a-z]+[A-Z][A-Za-z]+\b)|(\b[a-z]+_[a-z_]+\b)|(\b\w+\.(ts|js|md|json|yaml|tsx)\b)/g;

const fourgrams = (text: string) => {
  const t = norm(text);
  return t.slice(0, -3).map((_, i) => `${t[i]} ${t[i + 1]} ${t[i + 2]} ${t[i + 3]}`);
};
const distinctive = (text: string) =>
  new Set(norm(text).filter((w) => w.length >= 6 && !/^\d+$/.test(w)));
const stems = (text: string) =>
  new Set(
    norm(text)
      .filter((w) => w.length >= 5 && !/^\d+$/.test(w))
      .map((w) => w.slice(0, 5)),
  );
/** Reply sentences for `sentenceCoverage`: prose and list items, code fences removed, at least 3 content words. */
const replySentences = (reply: string) =>
  reply
    .replace(/```[\s\S]*?```/g, '\n')
    .split(/(?<=[.!?:])\s+|\n+/)
    .map((s) => norm(s).filter((w) => w.length >= 5 && !/^\d+$/.test(w)))
    .filter((ws) => ws.length >= 3);
const coverage = (part: string, all: Set<string>) => {
  const ws = [...distinctive(part)];
  return ws.length === 0 ? 1 : ws.filter((w) => all.has(w)).length / ws.length;
};

/** The reply's prose: without code fences, table rows and inline code. */
const replyProse = (reply: string) =>
  reply
    .replace(/```[\s\S]*?```/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l))
    .join('\n')
    .replace(/`[^`\n]*`/g, ' ');

/** Question sentences in the reply's prose (text ending in `?`). */
const replyQuestions = (reply: string) =>
  (replyProse(reply).match(/[^.!?\n]*\?/g) ?? [])
    .map((q) => q.trim())
    .filter((q) => distinctive(q).size > 0);

const decisionPattern =
  /\b(i'll (go with|pick|choose|fill|take|default to|assume|lean)|let me fill|i'd (go with|pick|lean)|we'll go with|going with|i'll decide|sensible defaults)\b/i;
const approvalPattern =
  /^(does|do|is|are|would|sound|can you live)\b.*\b(work for you|make sense|sound (right|good|okay)|look (right|good)|feel (right|clickable|okay)|settle it|right to you|okay with|happy with)/i;

const holdMisleadingPattern =
  /\b(keep going|let me (keep|continue|carry on|move on)|pick (it|up|back)|next up|here'?s the next|moving on|carry on|i'll go with|lock(ing|ed)|settled)\b/i;
const metaAskPattern =
  /\bwhich (of (these|them|those)|ones?)\b.*\b(first|tackle|views? on|answer now|start with|go through|discuss|weigh in)\b|\b(what|where) (do you want|would you like|should we) (to )?(tackle|start)\b/i;

const bundledAskPattern =
  /\b(any or all|answer (any|whichever|as many)|whichever (ones?|of these)|any of (these|them|those) you)\b/i;

/** Offers and soft invitations in the voice's own speech or screens (see `invitationBehindContinue`). */
const invitationPattern =
  /\b(i can also|i could also|want me to|if you want (it|them|this|that|me)\b|if (that|it) helps|say the word|tell me if|let me know if|when you want (it|them)|push back|happy to)\b/i;
/** Catch-all asks over several questions (see `catchAllAsks`). */
const catchAllAskPattern =
  /\b(answers? to (these|those|all|them|the)\b|whichever|any or all|any of (these|those|them)|(agree|happy|okay|fine|good) with (all|these|those|both)\b|(these|those|all|the) (two|three|four|five|six|seven|\d) (questions|decisions|calls|open)|how do you want to handle (these|those|both|all))/i;

const promisePattern =
  /\b(i'll|i will|let me|let's|we'll|get (started|to work|going|on it)|put (it )?together|pull (up|together)|kick off|work through|come back)\b/i;
const reactionPattern =
  /\b(got it|perfect|great|good call|nice|noted|makes sense|that keeps|locked|settled|it is\b|sounds good|love it|fair enough)/i;

export const runMetrics = (run: Run, c: Case): RunMetrics => {
  const elements = run.steps.flatMap((s) => s.elements);
  const speaks = elements.filter((e) => e.type === 'speak').map((e) => String(e.text));
  const shows = elements.filter((e) => e.type === 'show');
  const showText = shows
    .map((e) => String(e.content ?? '') + ' ' + String(e.title ?? ''))
    .join('\n');
  const mermaidNodes = shows
    .filter((e) => e.format === 'mermaid')
    .reduce(
      (n, e) => n + (String(e.content).match(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g)?.length ?? 0),
      0,
    );
  const perResponse = run.steps.map((s) => s.elements.filter((e) => e.type === 'show').length);
  const totalShows = shows.length;
  let backToBack = 0;
  for (const s of run.steps) {
    for (let i = 1; i < s.elements.length; i++) {
      if (s.elements[i]!.type === 'show' && s.elements[i - 1]!.type === 'show') backToBack++;
    }
  }
  const stepsBeforeEnd = run.end === 'forwarded' ? run.steps.slice(0, -1) : run.steps;
  const pausesWithoutAsk = stepsBeforeEnd.filter((s) => s.elements.at(-1)?.type !== 'ask').length;
  const asks = elements.filter((e) => e.type === 'ask');
  const isContinue = (e: Record<string, unknown>) =>
    Array.isArray(e.options) &&
    (e.options as Array<{ label: string }>).some((o) => /continue|next|go on/i.test(o.label)) &&
    (e.options as Array<unknown>).length <= 2;
  const last = run.steps.at(-1);
  const forwardIndex = last?.elements.findIndex((e) => e.type === 'forward') ?? -1;
  const spoken = speaks.join(' ');
  const spokenTri = trigrams(spoken);
  const showTri = trigrams(showText);
  const echo =
    spokenTri.size === 0 ? 0 : [...spokenTri].filter((t) => showTri.has(t)).length / spokenTri.size;
  const spokenWords = words(spoken);
  const showWords = words(showText);
  const rawWords = words(c.workerReply);
  const listenSeconds = (spokenWords / 160) * 60 + (showWords / 240) * 60 + mermaidNodes * 1.2;
  const rawReadSeconds = (rawWords / 240) * 60;
  const firstActions = run.steps.map(
    (s) => (s.generation.firstActionMs ?? s.generation.totalMs) / 1000,
  );
  const segments = perResponse.filter((n) => n > 0).length;
  const after = c.interrupt === undefined ? undefined : run.steps[c.interrupt.atStep];
  const afterForward = after?.elements[0]?.type === 'forward' ? after.elements.slice(1) : [];
  const agreeAfter = c.agree === undefined ? undefined : run.steps[c.agree.atStep];
  const agreement =
    c.agree === undefined
      ? {}
      : {
          // Keep going: the response after a plain agreement presents the next segment (or asks the
          // next question) and does not forward.
          continuedAfterAgreement:
            agreeAfter !== undefined &&
            !agreeAfter.elements.some((e) => e.type === 'forward') &&
            agreeAfter.elements.some((e) => e.type === 'show' || e.type === 'ask'),
        };
  const routing =
    c.interrupt === undefined
      ? {}
      : {
          interruptPostForwardContent: afterForward.filter(
            (e) => e.type === 'show' || e.type === 'ask',
          ).length,
          interruptHoldMisleading: holdMisleadingPattern.test(
            afterForward
              .filter((e) => e.type === 'speak')
              .map((e) => String(e.text))
              .join(' '),
          ),
          // A clean forward: `forward` first and nothing presented or asked after it.
          interruptForwardFirst:
            after?.elements[0]?.type === 'forward' &&
            after.elements.slice(1).every((e) => e.type !== 'show' && e.type !== 'ask') &&
            !holdMisleadingPattern.test(
              after.elements
                .filter((e) => e.type === 'speak')
                .map((e) => String(e.text))
                .join(' '),
            ),
          interruptAnswered:
            after === undefined ||
            after.elements.some((e) => e.type === 'show') ||
            words(
              after.elements
                .filter((e) => e.type === 'speak')
                .map((e) => String(e.text))
                .join(' '),
            ) > 25,
        };
  const replyGrams = new Set(fourgrams(c.workerReply));
  const showGrams = fourgrams(showText);
  const askText = elements
    .filter((e) => e.type === 'ask')
    .map(
      (e) =>
        `${String(e.question)} ${Array.isArray(e.options) ? (e.options as Array<{ label: string; description?: string }>).map((o) => `${o.label} ${o.description ?? ''}`).join(' ') : ''}`,
    )
    .join(' ');
  const walkWords = distinctive(`${spoken} ${showText} ${askText}`);
  const prose = replyProse(c.workerReply);
  const proseGrams = new Set(fourgrams(prose));
  const structuredGrams = new Set(
    fourgrams(
      [
        ...(c.workerReply.match(/```[\s\S]*?```/g) ?? []),
        ...c.workerReply.split('\n').filter((l) => /^\s*\|/.test(l)),
        ...(c.workerReply.match(/`[^`\n]*`/g) ?? []),
      ].join('\n'),
    ),
  );
  const askWords = distinctive(askText);
  const questions = replyQuestions(c.workerReply);
  const questionAsksIn = (s: Run['steps'][number]) =>
    s.elements.filter((e) => e.type === 'ask' && !isContinue(e)).length;
  const closingSpeech =
    run.end === 'forwarded' && last !== undefined && forwardIndex >= 0
      ? last.elements
          .slice(forwardIndex + 1)
          .filter((e) => e.type === 'speak')
          .map((e) => String(e.text))
          .join(' ')
      : '';
  const answerReactions = run.steps.filter((s, i) => {
    if (i === 0 || run.steps[i - 1]!.sim?.kind !== 'answer') return false;
    const first = s.elements.find((e) => e.type === 'speak');
    const sentence = first === undefined ? '' : String(first.text).split(/(?<=[.!?])\s/)[0]!;
    return reactionPattern.test(sentence);
  }).length;
  const reference = distinctive(
    `${c.workerReply} ${c.priorUserMessage ?? ''} ${c.contextSummary ?? ''}`,
  );
  const maxScreenNovelty = Math.max(
    0,
    ...run.steps.map((s) => {
      const ws = s.elements
        .filter((e) => e.type === 'show')
        .flatMap((e) => [...distinctive(`${String(e.content ?? '')} ${String(e.title ?? '')}`)]);
      return ws.length < 8 ? 0 : ws.filter((w) => !reference.has(w)).length / ws.length;
    }),
  );
  const decisionAfterAnswer = run.steps.filter(
    (s, i) =>
      i > 0 &&
      run.steps[i - 1]!.sim?.kind === 'answer' &&
      decisionPattern.test(
        s.elements
          .filter((e) => e.type === 'speak')
          .map((e) => String(e.text))
          .join(' '),
      ),
  ).length;
  const approvalAsks = asks.filter(
    (e) => !isContinue(e) && approvalPattern.test(String(e.question).trim()),
  ).length;
  const replyTokens = c.workerReply.split(/\s+/);
  const head = replyTokens.slice(0, Math.max(30, Math.ceil(replyTokens.length * 0.12))).join(' ');
  const tail = replyTokens.slice(Math.floor(replyTokens.length * 0.8)).join(' ');
  return {
    ...routing,
    ...agreement,
    screenCopy:
      showGrams.length === 0
        ? 0
        : showGrams.filter((g) => replyGrams.has(g)).length / showGrams.length,
    showCompression: rawWords === 0 ? 0 : showWords / rawWords,
    headCoverage: coverage(head, walkWords),
    sentenceCoverage: (() => {
      const walk = stems(`${spoken} ${showText} ${askText}`);
      const sentences = replySentences(c.workerReply);
      return sentences.length === 0
        ? 1
        : sentences.filter(
            (ws) => ws.filter((w) => walk.has(w.slice(0, 5))).length / ws.length >= 0.5,
          ).length / sentences.length;
    })(),
    tailCoverage: coverage(tail, walkWords),
    optionDescriptions: asks.reduce(
      (n, e) =>
        n +
        (Array.isArray(e.options)
          ? (e.options as Array<{ description?: string }>).filter(
              (o) => (o.description ?? '').trim() !== '',
            ).length
          : 0),
      0,
    ),
    whitespaceRunaway: run.steps.some((s) => /\s{200,}/.test(s.output)),
    asksInForwardResponse: run.end === 'forwarded' && last !== undefined ? questionAsksIn(last) : 0,
    multiQuestionResponses: run.steps.filter((s) => questionAsksIn(s) >= 2).length,
    proseCopy:
      showGrams.length === 0
        ? 0
        : showGrams.filter((g) => proseGrams.has(g) && !structuredGrams.has(g)).length /
          showGrams.length,
    replyQuestionCoverage:
      questions.length === 0
        ? 1
        : questions.filter((q) => {
            const d = [...distinctive(q)];
            return d.filter((w) => askWords.has(w)).length / d.length >= 0.5;
          }).length / questions.length,
    closingSpeechWords: words(closingSpeech),
    closingPromise: promisePattern.test(closingSpeech),
    answerReactions,
    maxScreenNovelty,
    decisionAfterAnswer,
    approvalAsks,
    questionListShows: shows.filter(
      (e) =>
        String(e.content ?? '')
          .split('\n')
          .filter((l) => l.includes('?')).length >= 2,
    ).length,
    metaAsks: asks.filter((e) => !isContinue(e) && metaAskPattern.test(String(e.question))).length,
    bundledQuestionAsks: asks.filter((e) => {
      if (isContinue(e)) return false;
      const numbers = new Set(
        (Array.isArray(e.options) ? (e.options as Array<{ label: string }>) : [])
          .map((o) => String(o.label).match(/^\s*Q?(\d+)\s*[.:)]/i)?.[1])
          .filter((n) => n !== undefined),
      );
      return numbers.size >= 2 || bundledAskPattern.test(String(e.question));
    }).length,
    invitationBehindContinue: run.steps.filter((s) => {
      const said = s.elements
        .filter((e) => e.type === 'speak' || e.type === 'show')
        .map((e) => `${String(e.text ?? '')} ${String(e.content ?? '')}`)
        .join(' ');
      const stepAsks = s.elements.filter((e) => e.type === 'ask');
      return invitationPattern.test(said) && stepAsks.length > 0 && stepAsks.every(isContinue);
    }).length,
    catchAllAsks: asks.filter(
      (e) =>
        !isContinue(e) &&
        (catchAllAskPattern.test(String(e.question)) ||
          (Array.isArray(e.options) &&
            (e.options as Array<{ label: string }>).some((o) => /^\s*yes,? all\b/i.test(o.label)))),
    ).length,
    priorMessageLeak: (() => {
      const prior = new Set(fourgrams(c.priorUserMessage ?? ''));
      return showGrams.filter((g) => prior.has(g) && !replyGrams.has(g)).length;
    })(),
    ok: run.end === 'forwarded' || run.end === 'closed',
    end: run.end,
    responses: run.steps.length,
    invalid: run.steps.reduce((n, s) => n + s.invalid.length, 0),
    segments,
    shows: totalShows,
    maxShowsPerResponse: Math.max(0, ...perResponse),
    dumpIndex: totalShows === 0 ? 1 : Math.max(...perResponse) / totalShows,
    pausesWithoutAsk,
    continueAsks: asks.filter(isContinue).length,
    questionAsks: asks.filter((e) => !isContinue(e)).length,
    backToBackShows: backToBack,
    forwardNotFirst: run.end === 'forwarded' && forwardIndex > 0,
    forwardedEarly: run.end === 'forwarded' && segments === 0,
    spokenWords,
    spokenWordsPerSegment: segments === 0 ? spokenWords : spokenWords / segments,
    showWords,
    rawWords,
    listenSeconds,
    rawReadSeconds,
    timeRatio: rawReadSeconds === 0 ? 0 : listenSeconds / rawReadSeconds,
    screenEcho: echo,
    spokenJargon: spoken.match(jargonPattern)?.length ?? 0,
    firstActionSec: firstActions[0] ?? 0,
    medianFirstActionSec: median(firstActions),
    meanResponseSec:
      run.steps.reduce((n, s) => n + s.generation.totalMs, 0) /
      1000 /
      Math.max(1, run.steps.length),
    reasoningTokens: run.steps.reduce((n, s) => n + (s.generation.usage?.reasoning ?? 0), 0),
  };
};
