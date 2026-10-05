import type { ToolDefinition } from '../../../packages/core/src/generation/tools.ts';
import { loadGold } from './data.ts';
import { generateWith, type Generation, type ModelOptions } from './model.ts';
/**
 * The drive loop, prompt-level: seed a history ending in a worker reply, then generate segment by
 * segment. A scripted listener answers each `ask` (Continue, or the worker's question) and sends
 * "Continue." after a natural pause. A scenario can interrupt at a given step instead. The loop
 * ends at a `forward`, at a speech-only reply after the walkthrough, or at the step cap.
 */
import type { Action, Example, Reminders } from './prompt.ts';
import {
  buildTools,
  jsonSchemaFor,
  promptParts,
  renderMessages,
  type PromptParts,
  type ToolText,
} from './prompt.ts';

const goldByCase = loadGold();

export type DriveState = {
  /** Generations so far in this walkthrough (0 before the first). */
  step: number;
  /** Generations that put at least one show on screen. */
  segments: number;
  /** What the newest input was. */
  last: 'reply' | 'continue' | 'answer' | 'interrupt' | 'message';
};

export type Variant = {
  id: string;
  notes: string;
  tools: ToolText;
  system: (tools: ReadonlyArray<ToolDefinition>, parts: PromptParts) => string;
  examples: ReadonlyArray<Example>;
  reminders: (state: DriveState) => Reminders | undefined;
  pause: 'ask' | 'natural';
  continueText?: string;
  model?: Partial<ModelOptions>;
  /** The lead speaker's name and personality (its id stays `host`). Default: Host, warm storyteller. */
  speaker?: { name: string; personality: string };
};

export type Case = {
  id: string;
  category: string;
  contextSummary?: string;
  priorUserMessage: string;
  workerReply: string;
  /** The worker's top-level text messages for this turn, in order (joined, they are workerReply). */
  workerMessages?: Array<string>;
  questionCount?: number;
  /** Optional scripted interruption: at this step's input, interrupt with `text` instead. */
  interrupt?: { atStep: number; text: string };
  /** Optional scripted plain agreement (not an interrupt) at this step, in place of pressing Continue. */
  agree?: { atStep: number; text: string };
  /** Optional earlier history (actions) to prepend, for late-session cases. */
  preamble?: ReadonlyArray<Action>;
};

type Element = Record<string, unknown> & { type: string };

export type Step = {
  step: number;
  newestInput: string;
  output: string;
  elements: Array<Element>;
  invalid: Array<string>;
  generation: Omit<Generation, 'text'>;
  sim?: {
    kind: 'continue' | 'answer' | 'interrupt' | 'message';
    text: string;
    match?: Array<string>;
  };
};

export type Run = {
  variant: string;
  caseId: string;
  rep: number;
  model: string;
  end: 'forwarded' | 'closed' | 'cap' | 'invalid' | 'error';
  steps: Array<Step>;
  system: string;
};

const id = 'x' as Action['id'];
const trim = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit)}…`;

export const seedHistory = (c: Case, forwardName = 'forward'): Array<Action> => [
  ...(c.preamble ?? []),
  { type: 'user_message', id, text: trim(c.priorUserMessage, 1500) },
  { type: 'tool_call', id, handle: 'call_1', tool: forwardName, input: {} },
  { type: 'speak', id, speaker: 'host', text: 'Let me look into that.' },
  {
    type: 'tool_result',
    id,
    handles: ['call_1'],
    tool: forwardName,
    result: { messages: c.workerMessages ?? [c.workerReply] },
  },
];

/**
 * The complete top-level elements of a broken reply, like Core's streaming parser keeps the actions
 * that closed before a failure.
 */
const salvage = (text: string): Array<Element> => {
  const start = text.indexOf('[');
  if (start < 0) return [];
  const out: Array<Element> = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let from = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') {
      depth++;
      if (depth === 2 && ch === '{') from = i;
    } else if (ch === '}' || ch === ']') {
      if (depth === 2 && ch === '}' && from >= 0) {
        try {
          out.push(JSON.parse(text.slice(from, i + 1)));
        } catch {
          return out;
        }
      }
      depth--;
    }
  }
  return out;
};

/** The JSON array in a reply, leniently: text before the first `[` is skipped, like Core. */
const parseOutput = (text: string): Array<Element> | string => {
  const start = text.indexOf('[');
  if (start < 0) return 'no_array';
  const end = text.lastIndexOf(']');
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(value) ? value : 'not_array';
  } catch (error) {
    return `json: ${String(error).slice(0, 120)}`;
  }
};

const validate = (element: Element): string | undefined => {
  switch (element.type) {
    case 'speak':
      return typeof element.text === 'string' && element.text.trim() !== ''
        ? undefined
        : 'speak_without_text';
    case 'show':
      return typeof element.content === 'string' &&
        ['markdown', 'mermaid', 'html'].includes(element.format as string)
        ? undefined
        : 'bad_show';
    case 'ask':
      return typeof element.question === 'string' &&
        ['text', 'choice', 'multi'].includes(element.kind as string) &&
        (element.kind === 'text' || (Array.isArray(element.options) && element.options.length > 0))
        ? undefined
        : 'bad_ask';
    case 'forward':
      return undefined;
    default:
      return `unknown_type:${element.type}`;
  }
};

const continuePattern = /\b(continue|next|go on|keep going|ready|carry on|move on|proceed)\b/i;
const readyQuestion =
  /\b(ready|continue|next part|next one|move on|go on|keep going|shall we|on to)\b/i;
const stop = new Set([
  'the',
  'and',
  'for',
  'you',
  'that',
  'this',
  'with',
  'are',
  'should',
  'would',
  'what',
  'which',
  'want',
  'can',
  'does',
  'did',
  'have',
  'from',
  'your',
  'our',
  'now',
  'then',
  'there',
  'they',
  'them',
  'will',
  'just',
  'about',
]);
const contentWords = (text: string) =>
  new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !stop.has(w)));
/** Overlap coefficient of content words. */
const similarity = (a: string, b: string) => {
  const x = contentWords(a);
  const y = contentWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
};

type GoldQuestion = { id: string; text: string; answer?: string; pick?: string; defer?: boolean };
const deferral = "I'd go with what you recommend.";
/** Which gold question the latest scripted answer matched (recorded in the run). */
let lastMatch = 'none';

/**
 * Scripted listener v2. A Continue is an ask with at most two options whose label says continue
 * and whose question is a readiness check (or a single Continue option). Any other ask is a
 * question: matched to a gold question, it gets that question's realistic answer (a choice picks
 * the option closest to the gold pick, else answers in free text), or the one scripted deferral;
 * an unmatched question gets a neutral free-text answer.
 */
const answerAsk = (
  ask: Element,
  gold: ReadonlyArray<GoldQuestion>,
  used: Set<string>,
): { kind: 'continue' | 'answer'; answer: Record<string, unknown> } => {
  lastMatch = 'none';
  const options = Array.isArray(ask.options) ? (ask.options as Array<{ label: string }>) : [];
  const question = String(ask.question);
  const contLabel = options.find((o) => continuePattern.test(o.label));
  const isContinue =
    (options.length === 1 && contLabel !== undefined) ||
    (options.length <= 2 && contLabel !== undefined && readyQuestion.test(question)) ||
    (options.length === 0 && readyQuestion.test(question) && question.length < 80);
  if (isContinue) {
    return {
      kind: 'continue',
      answer:
        contLabel && ask.kind === 'choice'
          ? { kind: 'choice', choice: contLabel.label }
          : { kind: 'text', text: 'Continue.' },
    };
  }
  // Match on the question and its options (the voice rephrases). A weak match still counts, but
  // an unmatched ask is a question the worker never asked: approval-shaped ones get a plain yes,
  // others a neutral answer.
  const asked = `${question} ${options.map((o) => o.label).join(' ')}`;
  const scored = gold
    .map((q) => ({
      q,
      score: similarity(asked, `${q.text} ${q.pick ?? ''}`) - (used.has(q.id) ? 0.2 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const approval =
    /\b(does (that|this) (work|sound|look)|sound good|look (good|right)|okay with (that|this)|work for you|happy with)\b/i.test(
      question,
    );
  const top = scored[0];
  const match =
    top !== undefined && (top.score >= 0.25 || (top.score >= 0.12 && !approval)) ? top : undefined;
  if (match !== undefined) used.add(match.q.id);
  lastMatch = match === undefined ? (approval ? 'none:approval' : 'none') : match.q.id;
  if (match === undefined && approval)
    return { kind: 'answer', answer: { kind: 'text', text: 'Sure, that works.' } };
  if (match === undefined || match.q.answer === undefined) {
    if (gold.length === 0 && ask.kind === 'choice' && options[0]) {
      return { kind: 'answer', answer: { kind: 'choice', choice: options[0].label } };
    }
    return { kind: 'answer', answer: { kind: 'text', text: 'No strong opinion on that one.' } };
  }
  const q = match.q;
  if (q.defer === true) return { kind: 'answer', answer: { kind: 'text', text: deferral } };
  if ((ask.kind === 'choice' || ask.kind === 'multi') && options.length > 0) {
    const best = options
      .map((o) => ({
        o,
        score: Math.max(
          similarity(o.label, q.pick ?? ''),
          similarity(o.label, q.answer ?? '') * 0.8,
        ),
      }))
      .sort((a, b) => b.score - a.score)[0]!;
    if (best.score >= 0.34) {
      return ask.kind === 'choice'
        ? { kind: 'answer', answer: { kind: 'choice', choice: best.o.label } }
        : { kind: 'answer', answer: { kind: 'multi', choices: [best.o.label] } };
    }
  }
  return { kind: 'answer', answer: { kind: 'text', text: q.answer } };
};

export const driveCase = async (
  variant: Variant,
  c: Case,
  rep: number,
  model: ModelOptions,
  maxSteps?: number,
): Promise<Run> => {
  const goldQuestions = (goldByCase.get(c.id)?.questions ?? []) as Array<GoldQuestion>;
  // Production has no cap; this one only stops loops. One extra response per worker question.
  const cap = maxSteps ?? 12 + goldQuestions.length;
  const usedGold = new Set<string>();
  const tools = buildTools(variant.tools);
  const system = variant.system(tools, promptParts(tools, variant.speaker));
  const jsonSchema = model.jsonSchema === null ? undefined : jsonSchemaFor(tools);
  const forwardName = variant.tools.forwardName ?? 'forward';
  const history = seedHistory(c, forwardName);
  let handle = 2;
  const state: DriveState = { step: 0, segments: 0, last: 'reply' };
  const steps: Array<Step> = [];
  const run: Run = {
    variant: variant.id,
    caseId: c.id,
    rep,
    model: model.model,
    end: 'cap',
    steps,
    system,
  };

  for (let step = 1; step <= cap; step++) {
    const messages = renderMessages(system, history, tools, variant.reminders(state));
    if (history.at(-1)?.type === 'generation_failed') {
      // A harness-level failure reminder (same for every variant): the usual cause of a broken
      // reply under constrained decoding is a raw double quote inside a text field.
      const last = messages.at(-1)!;
      messages[messages.length - 1] = {
        ...last,
        content: `${last.content}\n<reminder>Your last response broke off at a raw double quote inside a text field. Continue from where it stopped; inside text, quote with single quotes.</reminder>`,
      };
    }
    const generation = await generateWith(messages, {
      ...model,
      ...(model.model === 'qwen' ? { jsonSchema } : {}),
    });
    const { text, ...meta } = generation;
    const parsed = parseOutput(text);
    const record: Step = {
      step,
      newestInput: messages.at(-1)?.content ?? '',
      output: text,
      elements: typeof parsed === 'string' ? [] : parsed,
      invalid: typeof parsed === 'string' ? [parsed] : [],
      generation: meta,
    };
    steps.push(record);
    state.step = step;
    if (generation.error !== undefined) {
      run.end = 'error';
      return run;
    }
    let elements: Array<Element>;
    if (typeof parsed === 'string') {
      // Like production: keep the actions that closed, record the failure, and retry once (the
      // listener's retry); the next attempt reads a cut-off notice.
      elements = salvage(text);
      record.elements = elements;
      if (generation.runaway) record.invalid.push('whitespace_runaway');
      const failedBefore =
        steps.length > 1 && steps.at(-2)!.invalid.length > 0 && steps.at(-2)!.sim === undefined;
      if (failedBefore) {
        run.end = 'invalid';
        return run;
      }
    } else {
      elements = parsed;
    }
    // A renamed forward tool reads as `forward` in the record (metrics, rendering, judging).
    if (forwardName !== 'forward') {
      elements = elements.map((e) => (e.type === forwardName ? { ...e, type: 'forward' } : e));
      record.elements = elements;
    }
    const asks: Array<{ element: Element; handle: string }> = [];
    let forwarded = false;
    let shows = 0;
    for (const element of elements) {
      const problem = validate(element);
      if (problem !== undefined) {
        record.invalid.push(problem);
        continue;
      }
      if (element.type === 'speak') {
        history.push({ type: 'speak', id, speaker: 'host', text: String(element.text) });
        continue;
      }
      const { type, call: _call, ...input } = element;
      const h = `call_${handle++}`;
      history.push({
        type: 'tool_call',
        id,
        handle: h,
        tool: type === 'forward' ? forwardName : type,
        input: input as never,
      });
      if (type === 'forward') forwarded = true;
      if (type === 'show') shows++;
      if (type === 'ask') asks.push({ element, handle: h });
    }
    if (shows > 0) state.segments++;
    if (typeof parsed === 'string' && !forwarded) {
      history.push({
        type: 'generation_failed',
        id,
        error: { tag: 'MalformedOutput', message: 'invalid output' },
      });
      continue;
    }
    if (forwarded) {
      run.end = 'forwarded';
      return run;
    }

    // A routing case is decided by the response to the interrupt or agreement: stop there.
    const decidedAt = c.interrupt?.atStep ?? c.agree?.atStep;
    if (decidedAt !== undefined && step > decidedAt) {
      run.end = 'closed';
      return run;
    }
    const interrupt = c.interrupt?.atStep === step ? c.interrupt : undefined;
    if (interrupt !== undefined) {
      record.sim = { kind: 'interrupt', text: interrupt.text };
      state.last = 'interrupt';
      if (asks.length > 0) {
        // Interrupt through the open question's Interrupt action.
        const [first, ...rest] = asks;
        history.push({
          type: 'tool_result',
          id,
          handles: [first.handle],
          tool: 'ask',
          result: {
            question: String(first.element.question),
            answer: { kind: 'text', text: interrupt.text, interrupted: true },
          },
        });
        void rest;
      } else {
        history.push({ type: 'interrupted', id, during: 'wait' });
        history.push({ type: 'user_message', id, text: interrupt.text });
      }
      continue;
    }

    const agree = c.agree?.atStep === step ? c.agree : undefined;
    if (agree !== undefined) {
      record.sim = { kind: 'message', text: agree.text };
      state.last = 'message';
      if (asks.length > 0) {
        // Typed into the open question instead of pressing Continue (not through Interrupt).
        const [first, ...rest] = asks;
        history.push({
          type: 'tool_result',
          id,
          handles: [first.handle],
          tool: 'ask',
          result: {
            question: String(first.element.question),
            answer: { kind: 'text', text: agree.text },
          },
        });
        for (const ask of rest) {
          history.push({
            type: 'tool_result',
            id,
            handles: [ask.handle],
            tool: 'ask',
            result: {
              question: String(ask.element.question),
              answer: answerAsk(ask.element, goldQuestions, usedGold).answer,
            },
          });
        }
      } else {
        history.push({ type: 'user_message', id, text: agree.text });
      }
      continue;
    }

    if (asks.length > 0) {
      const answers = asks.map((ask) => {
        const a = answerAsk(ask.element, goldQuestions, usedGold);
        return { ask, ...a, match: a.kind === 'continue' ? 'continue' : lastMatch };
      });
      for (const { ask, answer } of answers) {
        history.push({
          type: 'tool_result',
          id,
          handles: [ask.handle],
          tool: 'ask',
          result: { question: String(ask.element.question), answer },
        });
      }
      const kind = answers.every((a) => a.kind === 'continue') ? 'continue' : 'answer';
      record.sim = {
        kind,
        text: answers.map((a) => JSON.stringify(a.answer)).join(' | '),
        match: answers.map((a) => a.match),
      };
      state.last = kind;
      continue;
    }
    if (shows === 0 && step > 1) {
      run.end = 'closed';
      return run;
    }
    const text2 = variant.continueText ?? 'Continue.';
    record.sim = { kind: 'continue', text: text2 };
    state.last = 'continue';
    history.push({ type: 'user_message', id, text: text2 });
  }
  return run;
};
