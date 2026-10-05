/**
 * Merges deterministic metrics and judgments per variant, computes the composite (0–100), and a
 * paired bootstrap of each variant against a baseline on shared (case, rep) runs.
 *
 *   node aggregate.ts --tag screen --variants base,a,b --baseline base [--cases screen] [--json state/results/x.json]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { loadCases, loadGold, type Gold, resolveCases } from './lib/data.ts';
import type { Case, Run } from './lib/drive.ts';
import {
  goldPointCoverage,
  goldQuestionsAnswered,
  runMetrics,
  type RunMetrics,
} from './lib/metrics.ts';

const { values } = parseArgs({
  options: {
    tag: { type: 'string' },
    model: { type: 'string', default: 'qwen' },
    variants: { type: 'string' },
    baseline: { type: 'string' },
    cases: { type: 'string' },
    json: { type: 'string' },
    perCase: { type: 'boolean', default: false },
  },
});

type Judgment = {
  points: Record<string, string>;
  questions: Record<string, string>;
  additions: Array<string>;
  burden: number;
  screens: number;
  speech: number;
  pacing: number;
  speed: number;
  engagement: number;
  overall: number;
  flags: Array<string>;
  notes: string;
};

export type Scored = {
  key: string;
  caseId: string;
  metrics: RunMetrics;
  judged: boolean;
  coreRecall?: number;
  detailRecall?: number;
  questionRate?: number;
  distortions?: number;
  additions?: number;
  judgment?: Judgment;
  composite?: number;
  /** Judge-free recall estimate: share of gold points (core / detail) whose stems appear in the walkthrough. */
  goldCov?: { core: number; detail: number };
  /** Judge-free: share of gold questions the scripted listener matched and answered. */
  answered?: number;
};

const cases = new Map(loadCases().map((c) => [c.id, c]));
const gold = loadGold();
const caseFilter = values.cases ? new Set(resolveCases(values.cases)) : undefined;

const n01 = (x: number) => (x - 1) / 4;
/** Interrupts that only agree ("Sounds good"): the hard routing class. */
const agreementCases = new Set<string>(
  JSON.parse(readFileSync('cases/sets.json', 'utf8'))['routing-agree'] ?? [],
);
const currentRubric =
  readFileSync('judge-rubric.md', 'utf8').match(/rubric (v[\d.]+)/)?.[1] ?? 'v?';

export const score = (run: Run, c: Case, g: Gold | undefined, j: Judgment | undefined): Scored => {
  const metrics = runMetrics(run, c);
  const coverage =
    g === undefined
      ? undefined
      : goldPointCoverage(
          run,
          g.points.filter((p) => p.weight !== 'narration'),
        );
  const out: Scored = {
    key: `${run.caseId}.r${run.rep}`,
    caseId: run.caseId,
    metrics,
    judged: false,
    ...(coverage === undefined
      ? {}
      : { goldCov: { core: coverage.core, detail: coverage.detail } }),
    ...(g === undefined || g.questions.length === 0
      ? {}
      : {
          answered: goldQuestionsAnswered(
            run,
            g.questions.map((q) => q.id),
          ).share,
        }),
  };
  if (g === undefined || j === undefined) return out;
  const verdict = (id: string) => j.points[id] ?? 'missing';
  const core = g.points.filter((p) => p.weight === 'core');
  const detail = g.points.filter((p) => p.weight === 'detail'); // 'narration' points are not scored
  const recall = (ps: typeof core) =>
    ps.length === 0 ? 1 : ps.filter((p) => verdict(p.id) === 'conveyed').length / ps.length;
  const qVerdicts = g.questions.map((q) => j.questions[q.id] ?? 'missing');
  const questionRate =
    g.questions.length === 0
      ? 1
      : qVerdicts.reduce((n, v) => n + (v === 'asked' ? 1 : v === 'spoken_only' ? 0.5 : 0), 0) /
        g.questions.length;
  const distortions =
    Object.values(j.points).filter((v) => v === 'distorted').length +
    qVerdicts.filter((v) => v === 'distorted').length;
  const additions = j.additions.length;
  const fidelity = 0.75 * recall(core) + 0.25 * recall(detail);
  const protocol =
    metrics.ok && !metrics.forwardNotFirst && metrics.invalid === 0 && !metrics.forwardedEarly
      ? 1
      : 0;
  const penalty = Math.min(0.3, 0.05 * distortions + 0.03 * additions);
  const composite =
    100 *
    (0.25 * fidelity +
      0.15 * questionRate +
      0.15 * (j.overall / 10) +
      0.1 * n01(j.burden) +
      0.08 * n01(j.screens) +
      0.07 * n01(j.pacing) +
      0.07 * n01(j.speed) +
      0.05 * n01(j.speech) +
      0.05 * n01(j.engagement) +
      0.03 * protocol -
      0.5 * penalty);
  return {
    ...out,
    judged: true,
    coreRecall: recall(core),
    detailRecall: recall(detail),
    questionRate,
    distortions,
    additions,
    judgment: j,
    composite,
  };
};

const mean = (xs: Array<number>) =>
  xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

export const loadVariant = (tag: string, model: string, variant: string): Array<Scored> => {
  const dir = `out/${tag}/${model}/${variant}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.r\d+\.json$/.test(f))
    .map((f) => {
      const run = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as Run;
      const jPath = `${dir}/${f.replace(/\.json$/, '.judge.json')}`;
      const j = existsSync(jPath)
        ? (JSON.parse(readFileSync(jPath, 'utf8')) as Judgment)
        : undefined;
      return score(run, cases.get(run.caseId)!, gold.get(run.caseId), j);
    })
    .filter((s) => caseFilter === undefined || caseFilter.has(s.caseId));
};

const summarize = (rows: Array<Scored>) => {
  const judged = rows.filter((r) => r.judged);
  const m = (f: (r: Scored) => number, rs = rows) => mean(rs.map(f));
  const flags: Record<string, number> = {};
  for (const r of judged) for (const f of r.judgment!.flags) flags[f] = (flags[f] ?? 0) + 1;
  return {
    runs: rows.length,
    judged: judged.length,
    composite: m((r) => r.composite!, judged),
    overall: m((r) => r.judgment!.overall, judged),
    coreRecall: m((r) => r.coreRecall!, judged),
    detailRecall: m((r) => r.detailRecall!, judged),
    questionRate: m((r) => r.questionRate!, judged),
    distortions: m((r) => r.distortions!, judged),
    additions: m((r) => r.additions!, judged),
    burden: m((r) => r.judgment!.burden, judged),
    screens: m((r) => r.judgment!.screens, judged),
    speech: m((r) => r.judgment!.speech, judged),
    pacing: m((r) => r.judgment!.pacing, judged),
    speed: m((r) => r.judgment!.speed, judged),
    engagement: m((r) => r.judgment!.engagement, judged),
    okRate: m((r) => (r.metrics.ok ? 1 : 0)),
    invalidPerRun: m((r) => r.metrics.invalid),
    forwardNotFirst: m((r) => (r.metrics.forwardNotFirst ? 1 : 0)),
    segments: m((r) => r.metrics.segments),
    dumpIndex: m((r) => r.metrics.dumpIndex),
    pausesWithoutAsk: m((r) => r.metrics.pausesWithoutAsk),
    spokenWordsPerSegment: m((r) => r.metrics.spokenWordsPerSegment),
    timeRatio: m((r) => r.metrics.timeRatio),
    screenEcho: m((r) => r.metrics.screenEcho),
    screenCopy: m((r) => r.metrics.screenCopy),
    tailCoverage: m((r) => r.metrics.tailCoverage),
    optionDescriptions: m((r) => r.metrics.optionDescriptions),
    runawayRate: m((r) => (r.metrics.whitespaceRunaway ? 1 : 0)),
    asksInForward: m((r) => r.metrics.asksInForwardResponse ?? 0),
    compression: m((r) => r.metrics.showCompression),
    sentCov: m((r) => r.metrics.sentenceCoverage ?? NaN),
    goldCovCore: m(
      (r) => r.goldCov?.core ?? NaN,
      rows.filter((r) => r.goldCov !== undefined),
    ),
    goldCovDetail: m(
      (r) => r.goldCov?.detail ?? NaN,
      rows.filter((r) => r.goldCov !== undefined),
    ),
    bundled: m((r) => r.metrics.bundledQuestionAsks ?? 0),
    answered: m(
      (r) => r.answered ?? NaN,
      rows.filter((r) => r.answered !== undefined),
    ),
    catchAll: m((r) => r.metrics.catchAllAsks ?? 0),
    invitationBehindContinue: m((r) => r.metrics.invitationBehindContinue ?? 0),
    closingPromise: m((r) => (r.metrics.closingPromise ? 1 : 0)),
    novelty: m((r) => r.metrics.maxScreenNovelty ?? 0),
    decide: m((r) => r.metrics.decisionAfterAnswer ?? 0),
    approve: m((r) => r.metrics.approvalAsks ?? 0),
    answerReactions: m((r) => r.metrics.answerReactions ?? 0),
    routingAgreement: m(
      (r) => (r.metrics.interruptForwardFirst ? 1 : 0),
      rows.filter(
        (r) => r.metrics.interruptForwardFirst !== undefined && agreementCases.has(r.caseId),
      ),
    ),
    continuedAfterAgreement: m(
      (r) => (r.metrics.continuedAfterAgreement ? 1 : 0),
      rows.filter((r) => r.metrics.continuedAfterAgreement !== undefined),
    ),
    routingOther: m(
      (r) => (r.metrics.interruptForwardFirst ? 1 : 0),
      rows.filter(
        (r) => r.metrics.interruptForwardFirst !== undefined && !agreementCases.has(r.caseId),
      ),
    ),
    multiAsk: m((r) => r.metrics.multiQuestionResponses ?? 0),
    questionsByKind: (() => {
      const tally: Record<string, [number, number]> = {};
      for (const r of judged) {
        for (const q of gold.get(r.caseId)?.questions ?? []) {
          const kind = (q as { kind?: string }).kind ?? '?';
          const v = r.judgment!.questions[q.id] ?? 'missing';
          const t = (tally[kind] ??= [0, 0]);
          t[0] += v === 'asked' ? 1 : v === 'spoken_only' ? 0.5 : 0;
          t[1] += 1;
        }
      }
      return Object.entries(tally)
        .map(([k, [a, n]]) => `${k} ${(a / n).toFixed(2)} (n=${n})`)
        .join(', ');
    })(),
    shortStopsPer100: m(
      (r) => (r.metrics.segments / Math.max(1, r.metrics.rawWords)) * 100,
      rows.filter((r) => r.metrics.rawWords < 250),
    ),
    staleJudgments: rows.filter(
      (r) => r.judged && (r.judgment as { rubric?: string }).rubric !== currentRubric,
    ).length,
    spokenJargon: m((r) => r.metrics.spokenJargon),
    firstActionSec: m((r) => r.metrics.firstActionSec),
    medianFirstActionSec: m((r) => r.metrics.medianFirstActionSec),
    meanResponseSec: m((r) => r.metrics.meanResponseSec),
    interruptForwardFirst: m(
      (r) => (r.metrics.interruptForwardFirst ? 1 : 0),
      rows.filter((r) => r.metrics.interruptForwardFirst !== undefined),
    ),
    interruptAnswered: m(
      (r) => (r.metrics.interruptAnswered ? 1 : 0),
      rows.filter((r) => r.metrics.interruptAnswered !== undefined),
    ),
    flags,
  };
};

/** A small seeded PRNG (mulberry32), so intervals are reproducible. */
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * Paired comparison over shared (case, rep) runs: the mean composite difference with a seeded,
 * case-clustered 90% bootstrap interval (cases are resampled with all their reps, since reps of
 * one case fail together). `runLo`/`runHi` is the older run-level interval, for reference.
 */
const paired = (a: Array<Scored>, b: Array<Scored>) => {
  const bk = new Map(b.filter((r) => r.judged).map((r) => [r.key, r.composite!]));
  const shared = a.filter((r) => r.judged && bk.has(r.key));
  const diffs = shared.map((r) => r.composite! - bk.get(r.key)!);
  if (diffs.length < 3)
    return { n: diffs.length, cases: 0, diff: NaN, lo: NaN, hi: NaN, runLo: NaN, runHi: NaN };
  const byCase = new Map<string, Array<number>>();
  shared.forEach((r, i) => byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), diffs[i]!]));
  const groups = [...byCase.values()];
  const random = rng(20261002);
  const clustered: Array<number> = [];
  const runLevel: Array<number> = [];
  for (let i = 0; i < 4000; i++) {
    let sum = 0;
    let count = 0;
    for (let k = 0; k < groups.length; k++) {
      const g = groups[Math.floor(random() * groups.length)]!;
      for (const d of g) sum += d;
      count += g.length;
    }
    clustered.push(sum / count);
    let s2 = 0;
    for (let k = 0; k < diffs.length; k++) s2 += diffs[Math.floor(random() * diffs.length)]!;
    runLevel.push(s2 / diffs.length);
  }
  clustered.sort((x, y) => x - y);
  runLevel.sort((x, y) => x - y);
  const q = (xs: Array<number>, p: number) => xs[Math.floor(p * xs.length)]!;
  return {
    n: diffs.length,
    cases: groups.length,
    diff: mean(diffs),
    lo: q(clustered, 0.05),
    hi: q(clustered, 0.95),
    runLo: q(runLevel, 0.05),
    runHi: q(runLevel, 0.95),
  };
};

if (import.meta.main) {
  const ids = values.variants!.split(',');
  const data = Object.fromEntries(
    ids.map((id) => [id, loadVariant(values.tag!, values.model!, id)]),
  );
  const result = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        ...summarize(data[id]!),
        vsBaseline:
          values.baseline && id !== values.baseline
            ? paired(data[id]!, data[values.baseline]!)
            : undefined,
      },
    ]),
  );
  const f = (x: number | undefined, d = 2) =>
    x === undefined || Number.isNaN(x) ? '–' : x.toFixed(d);
  console.log(
    '| variant | runs/judged | composite | Δ vs base [90% CI] | overall | core | detail | questions | answered | distort | adds | burden | screens | speech | pacing | speed | engage | ok | segs | dump | words/seg | time× | echo | copy | tail | optDesc | runaway | asks@fwd | multiAsk | compr | sentCov | goldCov c/d | bundled | catchAll | inviteBehindCont | closePromise | reactions | novelty | decide | approve | 1st act s | resp s | stale |',
  );
  console.log('|' + '---|'.repeat(43));
  for (const id of ids) {
    const s = result[id]!;
    const v = s.vsBaseline;
    console.log(
      `| ${id} | ${s.runs}/${s.judged} | ${f(s.composite, 1)} | ${v ? `${f(v.diff, 1)} [${f(v.lo, 1)}, ${f(v.hi, 1)}] n=${v.n}/${v.cases}c (run-level [${f(v.runLo, 1)}, ${f(v.runHi, 1)}])` : ''} | ${f(s.overall, 1)} | ${f(s.coreRecall)} | ${f(s.detailRecall)} | ${f(s.questionRate)} | ${f(s.answered)} | ${f(s.distortions)} | ${f(s.additions)} | ${f(s.burden, 1)} | ${f(s.screens, 1)} | ${f(s.speech, 1)} | ${f(s.pacing, 1)} | ${f(s.speed, 1)} | ${f(s.engagement, 1)} | ${f(s.okRate)} | ${f(s.segments, 1)} | ${f(s.dumpIndex)} | ${f(s.spokenWordsPerSegment, 0)} | ${f(s.timeRatio)} | ${f(s.screenEcho)} | ${f(s.screenCopy)} | ${f(s.tailCoverage)} | ${f(s.optionDescriptions, 1)} | ${f(s.runawayRate)} | ${f(s.asksInForward)} | ${f(s.multiAsk, 1)} | ${f(s.compression)} | ${f(s.sentCov)} | ${f(s.goldCovCore)}/${f(s.goldCovDetail)} | ${f(s.bundled, 2)} | ${f(s.catchAll, 2)} | ${f(s.invitationBehindContinue, 2)} | ${f(s.closingPromise)} | ${f(s.answerReactions, 1)} | ${f(s.novelty)} | ${f(s.decide)} | ${f(s.approve)} | ${f(s.firstActionSec, 1)} | ${f(s.meanResponseSec, 1)} | ${s.staleJudgments} |`,
    );
  }
  for (const id of ids) {
    const s = result[id]!;
    if (!Number.isNaN(s.continuedAfterAgreement)) {
      console.log(
        `continue-agree ${id}: kept walking after a plain agreement ${f(s.continuedAfterAgreement)}`,
      );
    }
    if (!Number.isNaN(s.interruptForwardFirst)) {
      console.log(
        `routing ${id}: forward-first after interrupt ${f(s.interruptForwardFirst)} (agreement-only interrupts ${f(s.routingAgreement)}, others ${f(s.routingOther)}), answered/presented instead ${f(s.interruptAnswered)}`,
      );
    }
  }
  for (const id of ids) {
    const s = result[id]!;
    console.log(
      `questions by kind ${id}: ${s.questionsByKind}; short replies (<250 words): ${f(s.shortStopsPer100)} segments per 100 words`,
    );
  }
  for (const id of ids) {
    const flags = Object.entries(result[id]!.flags).sort((a, b) => b[1] - a[1]);
    if (flags.length > 0)
      console.log(`flags ${id}: ${flags.map(([k, n]) => `${k}×${n}`).join(', ')}`);
  }
  if (values.perCase) {
    for (const id of ids) {
      console.log(
        `\nper case ${id}: ${data[id]!.filter((r) => r.judged)
          .map((r) => `${r.key}=${f(r.composite, 0)}`)
          .join(' ')}`,
      );
    }
  }
  if (values.json) {
    mkdirSync(dirname(values.json), { recursive: true });
    writeFileSync(values.json, JSON.stringify(result, null, 1));
  }
}
