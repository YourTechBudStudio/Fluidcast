export const meta = {
  name: 'drive-round',
  description:
    'One Fluidcast drive-mode hill-climb round: propose variants, screen, judge, full-test the best, decide, analyze',
  phases: [
    {
      title: 'Propose',
      detail: 'design new prompt variants from the journal, insights and backlog',
    },
    { title: 'Screen', detail: 'run candidates on the 8-case screen set + routing cases' },
    { title: 'Judge screen', detail: 'blind absolute judging against gold' },
    { title: 'Select', detail: 'aggregate and pick finalists' },
    { title: 'Full run', detail: 'finalists on the 27-case dev set + routing' },
    { title: 'Judge full', detail: 'absolute + blind pairwise vs champion' },
    { title: 'Decide', detail: 'promotion rule, state updates' },
    { title: 'Analyze', detail: 'failure analysis, new ideas, cases, metric proposals' },
  ],
};

const A = args;
const R = A.round;
const CH = A.champion;
// The absolute path of docs/evals in your checkout: pass it as args.dir.
const DIR = A.dir;
// Concurrent requests the voice model's server takes; keep the total within its capacity.
const CONC = A.conc ?? 3;
const J = A.judges ?? 8;
const FJ = A.fullJudges ?? 6;
const PJ = A.pairJudges ?? 6;
if (!DIR) return { error: 'pass args.dir: the absolute path of docs/evals' };
const PRE = `You are one agent in an unattended prompt-optimization loop for Fluidcast's voice model. Work in ${DIR}. First read loop-manual.md (the operating manual) and directions.md (the user's standing directions; obey them). Round ${R}; current champion variant: ${CH}.`;
const RUNNER = `${PRE}\nYou are the RUNNER: you execute commands exactly, without changing any code or variant. For every \`node run.ts ...\` command, use a Bash timeout of 600000 ms and re-run the identical command until its output ends with "done:" (it resumes; finished runs are skipped). Never run two run.ts commands at once.`;

const COMPLETE = {
  type: 'object',
  properties: { complete: { type: 'boolean' }, report: { type: 'string' } },
  required: ['complete', 'report'],
};
/** Runs a runner task, re-dispatching it (fresh agent) until it reports every expected run and packet present. */
const runUntilComplete = async (task, label, phaseName) => {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await agent(
      `${task}\nBefore returning, VERIFY completeness: for every variant and case set you ran, count the run files in out/<tag>/qwen/<variant>/ (python or ls) against cases × reps, and check each judge-prep/pairwise prep printed its packets. Set complete=false (and say what is missing) if anything is short; the task will be re-dispatched.`,
      {
        label: `${label}${attempt > 1 ? ` (retry ${attempt - 1})` : ''}`,
        phase: phaseName,
        model: 'sonnet',
        effort: 'low',
        schema: COMPLETE,
      },
    );
    if (last?.complete) return last;
    log(`${label}: incomplete (${last?.report?.slice(0, 200) ?? 'no report'}); retrying`);
  }
  return last;
};

// ---------------------------------------------------------------- Propose
phase('Propose');
let candidates = A.candidates;
let targets = A.targets ?? [];
if (!candidates) {
  const proposal = await agent(
    `${PRE}\nYou are the PROPOSER. Design ${A.nPropose ?? 4} new prompt variants for this round.\n` +
      `1. Read state/insights.md, state/backlog.md, state/journal.md, state/leaderboard.md, state/proposals.md and the newest files in state/results/.\n` +
      `2. Look at real failures: render 4–6 recent champion walkthroughs (node lib/render.ts out/dev/qwen/${CH}/<case>.r1.json, or out/screen/...) and read their .judge.json notes and flags.\n` +
      `3. Write each variant as variants/gen/r${R}-<letter>-<slug>.ts (id = file name without .ts) following the template variants/gen/_example.ts.txt; parent is normally ${CH}. One hypothesis each; notes must state parent, hypothesis and the exact change. Mix: at least one bold structural idea and at least one small targeted fix to the champion's most frequent failure. Do not repeat ideas the journal shows failed unless materially different.\n` +
      `4. Check each with node show-prompt.ts <id> and a smoke run: node run.ts --variants <id> --cases smoke --tag smoke-r${R} --conc 1 (timeout 600000), then node lib/render.ts on the output. Fix or delete broken variants.\n` +
      `5. Mark the backlog items you used as [tried r${R}].\n` +
      `6. For each candidate, name up to 3 target cases (dev case ids where its hypothesis should show; not heldout) in \`targets\`; they are screened too.\n` +
      `Return the final candidate list.`,
    {
      label: `propose r${R}`,
      schema: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                hypothesis: { type: 'string' },
                targets: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'hypothesis'],
            },
          },
        },
        required: ['candidates'],
      },
    },
  );
  candidates = [...(proposal?.candidates ?? []).map((c) => c.id), ...(A.extraCandidates ?? [])];
  targets = [...new Set((proposal?.candidates ?? []).flatMap((c) => c.targets ?? []))]
    .filter((t) => !t.startsWith('rt-'))
    .slice(0, 8);
  log(`Round ${R} candidates: ${candidates.join(', ')}`);
}
if (candidates.length === 0) return { round: R, error: 'no candidates' };
const ALL = [CH, ...candidates].join(',');

// ---------------------------------------------------------------- Screen
phase('Screen');
const screen = await runUntilComplete(
  `${RUNNER}\nRun, in this order:\n` +
    `1. node run.ts --variants ${ALL} --cases screen --reps ${A.screenReps ?? 2} --conc ${CONC} --tag screen\n` +
    `2. node run.ts --variants ${ALL} --cases continue-agree --reps 1 --conc ${CONC} --tag screen\n` +
    `3. node run.ts --variants ${ALL} --cases routing-other --reps 2 --conc ${CONC} --tag screen\n` +
    (targets.length
      ? `4. node run.ts --variants ${ALL} --cases ${targets.join(',')} --reps 2 --conc ${CONC} --tag screen\n`
      : '') +
    `5. node judge-prep.ts --tag screen --variants ${ALL} --batches ${J} --name r${R}-screen --cases ${['screen', ...targets].join(',')}\n` +
    `Report how many runs ended in each way and the judge-prep output line.`,
  `screen r${R}`,
  'Screen',
);
log(`Screen: ${screen?.report ?? 'no report'}`);

// ---------------------------------------------------------------- Judge screen
phase('Judge screen');
const judgeBatch = (name, k, label, phaseName) =>
  agent(
    `${PRE}\nYou are a JUDGE. Read judge-rubric.md carefully once. Then judge every packet (*.md) in ${DIR}/judging/${name}/batch-${k}/ that has no matching .json yet: for packet <id>.md write ${DIR}/judging/${name}/batch-${k}/<id>.json with exactly the JSON the rubric specifies. Judge each packet independently and carefully against its gold reference; check every gold point and question. Do not look at other batches, the out/ folder, or variant files: judging is blind. Return the number of packets judged.`,
    {
      label,
      phase: phaseName,
      schema: { type: 'object', properties: { judged: { type: 'number' } }, required: ['judged'] },
    },
  );
await parallel(
  Array.from(
    { length: J },
    (_, i) => () => judgeBatch(`r${R}-screen`, i + 1, `judge screen ${i + 1}`, 'Judge screen'),
  ),
);

// ---------------------------------------------------------------- Select
phase('Select');
const VARIANT_ROW = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    composite: { type: 'number' },
    delta: { type: 'number' },
    lo: { type: 'number' },
    hi: { type: 'number' },
    routingForwardFirst: { type: 'number' },
    okRate: { type: 'number' },
    coreRecall: { type: 'number' },
    detailRecall: { type: 'number' },
  },
  required: ['id', 'composite', 'coreRecall', 'detailRecall'],
};
const selected = await agent(
  `${RUNNER}\nRun:\n1. node judge-ingest.ts --name r${R}-screen (if packets are missing or invalid, judge those few yourself following judge-rubric.md, writing the .json into the batch folder, and ingest again)\n` +
    `2. node aggregate.ts --tag screen --variants ${ALL} --baseline ${CH} --cases screen --json state/results/r${R}-screen.json\n` +
    `3. node aggregate.ts --tag screen --variants ${ALL} --cases routing\n` +
    `Return the full table text of command 2, the routing lines of command 3, and one row per variant (composite, delta/lo/hi vs ${CH} where shown — use 0 for the baseline itself — routing forward-first rate, ok rate, core recall and detail recall from the core and detail columns). Use NaN-free numbers: write -1 if a value is missing.`,
  {
    label: `select r${R}`,
    model: 'sonnet',
    effort: 'low',
    schema: {
      type: 'object',
      properties: { table: { type: 'string' }, rows: { type: 'array', items: VARIANT_ROW } },
      required: ['table', 'rows'],
    },
  },
);
const rows = selected?.rows ?? [];
const champRow = rows.find((r) => r.id === CH);
const cands = rows
  .filter((r) => r.id !== CH && r.composite >= 0)
  .sort((a, b) => b.composite - a.composite);
const floor = (champRow?.composite ?? 0) - (A.screenMargin ?? 1.0);
// Recall pre-gate (fidelity first): screen recall may not trail the champion's by more than the
// dev gates plus a small allowance for the screen's noise.
const recallOk = (r) =>
  champRow === undefined ||
  (r.coreRecall >= champRow.coreRecall - (A.screenCoreSlack ?? 0.03) &&
    r.detailRecall >= champRow.detailRecall - (A.screenDetailSlack ?? 0.07));
const blocked = cands.filter((r) => r.composite >= floor && !recallOk(r)).map((r) => r.id);
if (blocked.length) log(`Recall pre-gate held back: ${blocked.join(', ')}`);
const finalists = [
  ...new Set([
    ...(A.forceFinalists ?? []),
    ...cands.filter((r) => r.composite >= floor && recallOk(r)).map((r) => r.id),
  ]),
].slice(0, A.maxFinalists ?? 2);
log(
  `Screen composite: ${rows.map((r) => `${r.id}=${r.composite.toFixed(1)}`).join(', ')}. Finalists: ${finalists.join(', ') || 'none'}`,
);

// ---------------------------------------------------------------- Full run + judge
let decision = null;
const analysisTargets = finalists.length > 0 ? [CH, ...finalists] : [CH, ...candidates];
if (finalists.length > 0) {
  phase('Full run');
  const FULL = [CH, ...finalists].join(',');
  await runUntilComplete(
    `${RUNNER}\nRun, in this order:\n` +
      `1. node run.ts --variants ${FULL} --cases dev --reps ${A.fullReps ?? 3} --conc ${CONC} --tag dev\n` +
      `2. node run.ts --variants ${FULL} --cases continue-agree --reps 1 --conc ${CONC} --tag dev && node run.ts --variants ${FULL} --cases routing-other --reps 2 --conc ${CONC} --tag dev\n` +
      `3. node judge-prep.ts --tag dev --variants ${FULL} --batches ${FJ} --name r${R}-dev --cases dev\n` +
      finalists
        .map(
          (f, i) =>
            `${4 + i}. node pairwise.ts prep --tag dev --a ${CH} --b ${f} --name r${R}-pair-${f} --batches ${PJ} --cases dev\n`,
        )
        .join('') +
      `Report the output lines of the prep commands.`,
    `full r${R}`,
    'Full run',
  );

  phase('Judge full');
  const pairBatch = (name, k) =>
    agent(
      `${PRE}\nYou are a PAIRWISE JUDGE. Read judge-rubric.md (first sections) and pairwise-rubric.md once. Then for every packet (*.md) in ${DIR}/judging/${name}/batch-${k}/ without a matching .json, compare walkthroughs X and Y and write ${DIR}/judging/${name}/batch-${k}/<id>.json with exactly the JSON pairwise-rubric.md specifies. Judging is blind: do not open the manifest, out/, or variant files. Return the number of packets judged.`,
      {
        label: `pair ${name.split('-pair-')[1]} ${k}`,
        phase: 'Judge full',
        schema: {
          type: 'object',
          properties: { judged: { type: 'number' } },
          required: ['judged'],
        },
      },
    );
  await parallel([
    ...Array.from(
      { length: FJ },
      (_, i) => () => judgeBatch(`r${R}-dev`, i + 1, `judge dev ${i + 1}`, 'Judge full'),
    ),
    ...finalists.flatMap((f) =>
      Array.from({ length: PJ }, (_, i) => () => pairBatch(`r${R}-pair-${f}`, i + 1)),
    ),
  ]);

  // -------------------------------------------------------------- Decide
  phase('Decide');
  decision = await agent(
    `${PRE}\nYou are the DECIDER for round ${R}. Finalists: ${finalists.join(', ')}.\n` +
      `1. node judge-ingest.ts --name r${R}-dev (judge any missing packets yourself per judge-rubric.md, then ingest again).\n` +
      `2. node aggregate.ts --tag dev --variants ${FULL} --baseline ${CH} --cases dev --json state/results/r${R}-dev.json\n` +
      `3. node aggregate.ts --tag dev --variants ${FULL} --cases routing\n` +
      finalists.map((f) => `4. node pairwise.ts score --name r${R}-pair-${f}\n`).join('') +
      `5. Apply the promotion rule and gates in loop-manual.md exactly. At most one finalist can be promoted (the best). If promoted, write state/champion.json {"id","since":"round ${R}","notes"}.\n` +
      `6. Append to state/leaderboard.md (one row per finalist, plus the champion's row if it has none), and append a journal entry to state/journal.md: candidates and hypotheses (see variants/gen/r${R}-*.ts notes), the screen table (state/results/r${R}-screen.json), the dev table, pairwise results, decision with the rule that decided it, and one paragraph of lessons.\n` +
      `Return the decision.`,
    {
      label: `decide r${R}`,
      schema: {
        type: 'object',
        properties: {
          promoted: { type: 'boolean' },
          champion: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['promoted', 'champion', 'summary'],
      },
    },
  );
} else {
  phase('Decide');
  decision = await agent(
    `${PRE}\nYou are the DECIDER for round ${R}. No candidate came within ${A.screenMargin ?? 1.0} composite points of the champion on the screen set, so nothing was full-tested. Append a journal entry to state/journal.md: candidates and hypotheses (variants/gen/r${R}-*.ts notes), the screen table (node aggregate.ts --tag screen --variants ${ALL} --baseline ${CH} --cases screen), and one paragraph of lessons (why each idea likely failed, using the judge notes in out/screen/qwen/<variant>/*.judge.json). The champion stays ${CH}. Return the decision.`,
    {
      label: `decide r${R}`,
      schema: {
        type: 'object',
        properties: {
          promoted: { type: 'boolean' },
          champion: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['promoted', 'champion', 'summary'],
      },
    },
  );
}

// ---------------------------------------------------------------- Analyze
phase('Analyze');
const analysis = await agent(
  `${PRE}\nYou are the ANALYST for round ${R}. Decision: ${JSON.stringify(decision)}.\n` +
    `Study where the newest walkthroughs still fail, for ${analysisTargets.join(', ')}: read judge notes and flags (out/*/qwen/<variant>/*.judge.json), render the worst-scoring runs (node aggregate.ts ... --perCase to find them; node lib/render.ts to read them), compare with the worker replies, and check the routing cases. Also check whether the judges and metrics are measuring the right thing (e.g. a judge too lenient on screens that copy the reply, a metric that rewards the wrong behaviour, a failure mode no metric catches).\n` +
    `Then:\n- Update state/insights.md with durable, evidence-backed lessons (variant ids, case ids).\n- Re-rank state/backlog.md: add the 3–6 most promising new ideas at the top, each with a one-line rationale tied to evidence.\n- If the suite misses an important situation (e.g. a reply type, a mid-walkthrough interrupt kind, a late-session history), add up to 3 cases to cases/extra-r${R}.jsonl (same fields as cases/candidate-cases.jsonl; prefer real worker replies from the user's transcripts under ~/.claude/projects, else realistic synthetic ones) with gold in cases/gold-extra-r${R}.jsonl (same shape as cases/gold-a.jsonl), and add their ids to the "dev" set in cases/sets.json (never to screen or heldout). Interrupt cases need an "interrupt" field and go in the "routing" set instead (no gold needed).\n- Write rubric/metric/composite/process suggestions to state/proposals.md (do not edit judge-rubric.md, lib/metrics.ts or aggregate.ts scoring yourself; additive new metric fields in lib/metrics.ts that do not change the composite are allowed).\n` +
    `Return a short summary for the orchestrator.`,
  {
    label: `analyze r${R}`,
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        topFailures: { type: 'array', items: { type: 'string' } },
        newCases: { type: 'array', items: { type: 'string' } },
        proposals: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'topFailures'],
    },
  },
);

return {
  round: R,
  champion: decision?.champion ?? CH,
  promoted: decision?.promoted ?? false,
  decision: decision?.summary,
  screenTable: selected?.table,
  finalists,
  analysis,
};
