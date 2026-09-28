import {
  Bot,
  Check,
  ChevronRight,
  Ellipsis,
  FilePen,
  FileText,
  Globe,
  type LucideIcon,
  Search,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import type { TranscriptEntry } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { Chip, Prose } from '../ui';
import {
  instructionPreview,
  lineCount,
  prettyInput,
  shortInput,
  type ToolNode,
  type ToolState,
  toolState,
  type TranscriptNode,
  transcriptTree,
  turns,
} from './transcript';

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: SquareTerminal,
  Read: FileText,
  Edit: FilePen,
  Write: FilePen,
  Grep: Search,
  Glob: Search,
  WebSearch: Globe,
  WebFetch: Globe,
  Agent: Bot,
};

const toolIcon = (name: string): LucideIcon => TOOL_ICONS[name] ?? Wrench;

/** "Turn ended", or its error outcome; a usage limit says when it resets, when that is known. */
const outcomeLabel = (outcome: string, resetsAt: number | undefined) => {
  if (outcome === 'success') return 'Turn ended';
  const resets =
    resetsAt === undefined
      ? ''
      : ` · resets ${new Date(resetsAt * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
  return `Turn ended: ${outcome}${resets}`;
};

interface Item {
  readonly key: string;
  readonly marker: ReactNode;
  readonly body: ReactNode;
  /** Space before a new turn. */
  readonly gap?: boolean;
}

interface Speaker {
  readonly agent: string;
  readonly agentType: string;
  readonly working: boolean;
}

/**
 * A worker's transcript on the main transcript's rail: 30 px markers on a vertical line, the raw entry type on the
 * right. A tool call is one row with its result folded in, shown on click.
 */
export function WorkerTranscript({
  entries,
  agent,
  agentType,
  working,
}: {
  readonly entries: ReadonlyArray<TranscriptEntry>;
  readonly agent: string;
  readonly agentType: string;
  readonly working: boolean;
}) {
  const all = useMemo(() => turns(transcriptTree(entries)), [entries]);
  const speaker: Speaker = { agent, agentType, working };
  const items: Item[] = [];
  all.forEach((turn, t) => {
    let afterText = false;
    turn.nodes.forEach((node, n) => {
      items.push(itemOf(node, speaker, afterText, t > 0 && n === 0));
      afterText = node.kind === 'text';
    });
    if (working && t === all.length - 1 && turn.end === undefined) {
      items.push({
        key: `${turn.key}-working`,
        marker: <Marker tone="live" />,
        body: (
          <Head>
            <span className="text-sm text-violet">Working</span>
          </Head>
        ),
      });
    } else if (turn.end !== undefined) {
      const ok = turn.end.outcome === 'success';
      items.push({
        key: turn.end.key,
        marker: (
          <Marker tone={ok ? 'ok' : 'error'}>
            {ok ? <Check size={13} strokeWidth={2} /> : <X size={13} strokeWidth={2} />}
          </Marker>
        ),
        body: (
          <Head type="turnEnd">
            <span className={`text-sm ${ok ? 'text-fg-subtle' : 'font-semibold text-red'}`}>
              {outcomeLabel(turn.end.outcome, turn.end.resetsAt)}
            </span>
          </Head>
        ),
      });
    }
  });
  return <Rail items={items} />;
}

function itemOf(node: TranscriptNode, speaker: Speaker, afterText: boolean, gap: boolean): Item {
  switch (node.kind) {
    case 'prompt':
      return {
        key: node.key,
        gap,
        marker: (
          <Marker tone="prompt">
            <i className="size-2 rounded-full bg-linear-135 from-cyan to-violet shadow-[0_0_10px_rgb(145_215_227/0.5)]" />
          </Marker>
        ),
        body: <PromptRow source={node.source} text={node.text} />,
      };
    case 'text':
      return {
        key: node.key,
        gap,
        marker: afterText ? (
          <Marker tone="dot" />
        ) : (
          <Marker tone="worker">{speaker.agentType[0]?.toUpperCase()}</Marker>
        ),
        body: (
          <>
            {!afterText && (
              <Head type="text">
                <span className="font-semibold text-fg">{speaker.agent}</span>
                <span className="font-mono text-[11.5px] tracking-[0.03em] text-fg-subtle">
                  {speaker.agentType}
                </span>
              </Head>
            )}
            <Prose source={node.text} compact className={afterText ? 'pt-1' : ''} />
          </>
        ),
      };
    case 'status':
      return {
        key: node.key,
        marker: <Marker tone="dot" />,
        body: <p className="pt-1.5 text-[14px] text-fg-subtle italic">{node.text}</p>,
      };
    case 'tool': {
      const state = toolState(node, speaker.working);
      return {
        key: node.key,
        gap,
        marker: <ToolMarker name={node.call.name} state={state} />,
        body: <ToolRow node={node} state={state} speaker={speaker} />,
      };
    }
    case 'turnEnd':
      // A nested turn end (a subagent's) reads as a plain line; top-level ones are drawn per turn.
      return {
        key: node.key,
        marker: <Marker tone="dot" />,
        body: (
          <p className="pt-1.5 text-[14px] text-fg-subtle">
            {outcomeLabel(node.outcome, node.resetsAt)}
          </p>
        ),
      };
  }
}

function Rail({
  items,
  nested = false,
}: {
  readonly items: ReadonlyArray<Item>;
  readonly nested?: boolean;
}) {
  return (
    <ol className={nested ? 'mt-1' : ''}>
      {items.map((item, i) => (
        <li
          key={item.key}
          className={`relative grid grid-cols-[30px_minmax(0,1fr)] gap-x-3.5 pb-2 ${item.gap ? 'mt-5' : ''}`}
        >
          <span
            aria-hidden
            className={`absolute left-[14.5px] w-px bg-line/40 ${i === 0 ? 'top-[15px]' : 'top-0'} ${i === items.length - 1 ? 'h-[15px]' : 'bottom-0'}`}
          />
          {item.marker}
          <div className="min-w-0">{item.body}</div>
        </li>
      ))}
    </ol>
  );
}

function Head({ type, children }: { readonly type?: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] flex-wrap items-center gap-2 text-sm">
      {children}
      {type && (
        <span className="ml-auto font-mono text-[11px] text-fg-subtle/75 max-sm:hidden">
          {type}
        </span>
      )}
    </div>
  );
}

type Tone = 'prompt' | 'worker' | 'dot' | 'live' | 'ok' | 'error' | 'running' | 'neutral';

const TONES: Record<Exclude<Tone, 'dot'>, string> = {
  prompt: 'bg-canvas shadow-[0_0_0_1px_rgb(145_215_227/0.4)]',
  worker: 'bg-violet/18 text-violet shadow-[0_0_0_1px_rgb(198_160_246/0.45)]',
  live: 'bg-violet/12 text-violet shadow-[0_0_0_1px_rgb(198_160_246/0.4)] motion-safe:animate-breathe',
  ok: 'bg-canvas text-green/80 shadow-[0_0_0_1px_rgb(166_218_149/0.35)]',
  error: 'bg-red/14 text-red shadow-[0_0_0_1px_rgb(237_135_150/0.45)]',
  running:
    'bg-violet/12 text-violet shadow-[0_0_0_1px_var(--color-violet),0_0_14px_rgb(198_160_246/0.45)]',
  neutral: 'bg-elevated text-fg-subtle shadow-[0_0_0_1px_rgb(91_96_120/0.6)]',
};

function Marker({ tone, children }: { readonly tone: Tone; readonly children?: ReactNode }) {
  const base =
    'relative z-10 grid size-[30px] place-items-center rounded-full font-display text-xs font-semibold';
  if (tone === 'dot') {
    return (
      <span aria-hidden className={base}>
        <i className="size-[7px] rounded-full bg-[color-mix(in_srgb,var(--color-violet)_45%,var(--color-line))]" />
      </span>
    );
  }
  return (
    <span aria-hidden className={`${base} ${TONES[tone]}`}>
      {tone === 'live' ? <Ellipsis size={14} strokeWidth={1.8} /> : children}
    </span>
  );
}

const MARKER_TONE: Record<ToolState, Tone> = {
  running: 'running',
  error: 'error',
  ok: 'neutral',
  open: 'neutral',
};

function ToolMarker({ name, state }: { readonly name: string; readonly state: ToolState }) {
  const Icon = toolIcon(name);
  return (
    <Marker tone={MARKER_TONE[state]}>
      <Icon size={13} strokeWidth={1.8} />
    </Marker>
  );
}

/** A prompt collapsed to its instruction; expanded, the exact text sent. */
function PromptRow({
  source,
  text,
}: {
  readonly source: 'fluidcast' | 'earlier';
  readonly text: string;
}) {
  const [open, setOpen] = useState(false);
  const bubble = 'rounded-[6px_16px_16px_16px] border border-line/35 bg-elevated/70';
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mt-[7px] flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
      >
        <span className="shrink-0 font-semibold text-fg">
          {source === 'fluidcast' ? 'Hand-off' : 'Earlier prompt'}
        </span>
        <ChevronRight
          size={14}
          strokeWidth={1.8}
          aria-hidden
          className={`shrink-0 text-fg-subtle transition-transform duration-(--duration-ui) ease-expo ${open ? 'rotate-90' : ''}`}
        />
        <span className="ml-auto font-mono text-[11px] text-fg-subtle/75 max-sm:hidden">
          prompt · {source}
        </span>
      </button>
      {open ? (
        <pre
          className={`${bubble} mt-1 max-h-[55vh] overflow-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-muted`}
        >
          {text}
        </pre>
      ) : (
        <p className={`${bubble} px-3.5 py-2.5 text-[15px] text-fg-muted`}>
          <span className="line-clamp-2">{instructionPreview(text)}</span>
        </p>
      )}
    </div>
  );
}

/** One row per call. A subagent's steps stay collapsed behind its latest status line until the row is opened. */
function ToolRow({
  node,
  state,
  speaker,
}: {
  readonly node: ToolNode;
  readonly state: ToolState;
  readonly speaker: Speaker;
}) {
  const [open, setOpen] = useState(false);
  const { call, result, children } = node;
  const output = result?.content ?? '';
  const subagent = children.length > 0;
  const latestStatus = children.findLast((child) => child.kind === 'status');
  const lines = lineCount(output);
  // A subagent's steps are never the worker's own running call.
  const nested: Speaker = { ...speaker, working: false };
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mt-[7px] flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
      >
        <span className="shrink-0 font-mono text-[13px] font-semibold text-fg">{call.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg-muted">
          {shortInput(call.input)}
        </span>
        {state === 'running' && (
          <Chip tone="violet" live>
            Running
          </Chip>
        )}
        {state === 'error' && <Chip tone="red">Error</Chip>}
        {state === 'ok' && (
          <span className="shrink-0 font-mono text-[11px] text-fg-subtle max-sm:hidden">
            {subagent
              ? `${children.filter((child) => child.kind === 'tool').length} steps`
              : `${lines} ${lines === 1 ? 'line' : 'lines'}`}
          </span>
        )}
      </button>
      {subagent && !open && latestStatus && (
        <p className="-mt-1.5 mb-1 truncate text-[14px] text-fg-subtle italic">
          {latestStatus.text}
        </p>
      )}
      {subagent && open && (
        <Rail
          items={children.map((child, i) =>
            itemOf(child, nested, children[i - 1]?.kind === 'text', false),
          )}
          nested
        />
      )}
      {open && (
        <div className="mt-1 mb-2 flex flex-col gap-2.5">
          <Pre label="Input" cut={call.truncated}>
            {prettyInput(call.input)}
          </Pre>
          {result && (
            <Pre
              label={state === 'error' ? 'Error' : 'Output'}
              error={state === 'error'}
              cut={result.truncated}
            >
              {output}
            </Pre>
          )}
        </div>
      )}
    </div>
  );
}

function Pre({
  label,
  error = false,
  cut = false,
  children,
}: {
  readonly label: string;
  readonly error?: boolean;
  readonly cut?: boolean;
  readonly children: string;
}) {
  return (
    <div>
      <p className="mb-1 font-mono text-[10.5px] font-medium tracking-[0.06em] text-fg-subtle uppercase">
        {label}
      </p>
      <pre
        className={`max-h-[50vh] overflow-auto rounded-md border px-3.5 py-2.5 font-mono text-[12px] leading-5 whitespace-pre-wrap ${error ? 'border-red/25 bg-red/6 text-red/90' : 'border-line/30 bg-scrim/40 text-fg-muted'}`}
      >
        {children}
      </pre>
      {cut && <p className="mt-1 font-mono text-[11px] text-fg-subtle">Cut at 4,000 characters.</p>}
    </div>
  );
}
