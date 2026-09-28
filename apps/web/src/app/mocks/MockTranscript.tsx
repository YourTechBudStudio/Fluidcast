// MOCK ONLY. The main transcript's new rows (program-design §9.1): agent, agent result, progress and the wait-case
// Interrupted row. Existing rows (You, speak, Show) copy `conversation/Transcript.tsx` markup so the new ones sit in context.

import { ChevronDown, CornerDownRight, Square, SquareTerminal, User } from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { FORMAT_NODE, FormatIcon, ShowBodyView, ShowCard, ShowCardTitle } from '../../tools';
import { Chip } from '../../ui';
import { renderWorkerMarkdown } from './helpers';
import { Prose } from './shared';
import type { MockRow } from './transcriptScenes';

const SPEAKER = { name: 'Iris', id: 'host', tone: 'var(--color-blue)' } as const;

export function MockTranscript({
  rows,
  onOpenWorker,
}: {
  readonly rows: ReadonlyArray<MockRow>;
  readonly onOpenWorker: (agent: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [rows]);
  return (
    <div
      ref={scroller}
      className="absolute inset-0 overflow-y-auto px-4 pt-2 pb-6 [mask-image:linear-gradient(transparent,#000_28px)]"
    >
      <ol aria-label="Transcript" className="mx-auto max-w-220">
        {rows.map((row, i) => (
          <Item
            key={row.id}
            row={row}
            first={i === 0}
            last={i === rows.length - 1}
            onOpenWorker={onOpenWorker}
          />
        ))}
      </ol>
    </div>
  );
}

function Item({
  row,
  first,
  last,
  onOpenWorker,
}: {
  readonly row: MockRow;
  readonly first: boolean;
  readonly last: boolean;
  readonly onOpenWorker: (agent: string) => void;
}) {
  switch (row.kind) {
    case 'user':
      return (
        <Row node={<Node kind="you" />} first={first} last={last} turn>
          <Head type="user_message">
            <span className="font-semibold text-fg">You</span>
          </Head>
          <p className="mt-0.5 rounded-[6px_16px_16px_16px] border border-line/35 bg-elevated/70 px-3.5 py-2.5 text-fg">
            {row.text}
          </p>
        </Row>
      );
    case 'speak': {
      const text = (
        <p className="pt-0.5 text-[17px] leading-normal text-fg-muted">
          {row.text}{' '}
          {row.interrupted && (
            <span className="ml-1 inline-flex gap-1.5">
              <Chip tone="amber">Interrupted</Chip>
            </span>
          )}
        </p>
      );
      return row.continued ? (
        <Row
          node={<Node kind="continued" />}
          first={first}
          last={last}
          style={{ '--sc': SPEAKER.tone } as CSSProperties}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">{text}</div>
            <Type>speak</Type>
          </div>
        </Row>
      ) : (
        <Row
          node={<Node kind="speaker" />}
          first={first}
          last={last}
          style={{ '--sc': SPEAKER.tone } as CSSProperties}
        >
          <Head type="speak">
            <span className="font-semibold text-fg">{SPEAKER.name}</span>
            <span className="font-mono text-[11.5px] tracking-[0.03em] text-fg-subtle">
              {SPEAKER.id}
            </span>
          </Head>
          {text}
        </Row>
      );
    }
    case 'interrupted':
      return (
        <Row node={<Node kind="interrupted" />} first={first} last={last}>
          <Head type="interrupted">
            <span className="font-semibold text-amber">
              {row.during === 'speech' ? 'You interrupted' : 'You interrupted to say something'}
            </span>
          </Head>
          {row.during === 'speech' && (
            <p className="text-[14.5px] text-fg-muted">
              Lines that hadn’t played yet were dropped.
            </p>
          )}
        </Row>
      );
    case 'show':
      return (
        <Row
          node={
            <span
              aria-hidden
              className={`relative z-10 grid size-[30px] place-items-center rounded-full ${FORMAT_NODE[row.input.format]}`}
            >
              <FormatIcon format={row.input.format} size={13} />
            </span>
          }
          first={first}
          last={last}
        >
          <Head type={`tool_call · ${row.handle}`}>
            <ShowCardTitle input={row.input} failure={null} corrects={false} />
          </Head>
          <ShowCard
            input={row.input}
            failure={null}
            active
            onOpen={() => undefined}
            miniature={
              <ShowBodyView
                input={row.input}
                body={{
                  state: 'rendered',
                  rendered: { kind: 'markup', html: renderWorkerMarkdown(row.input.content) },
                }}
              />
            }
          />
        </Row>
      );
    case 'agent':
      return <AgentRow row={row} first={first} last={last} onOpenWorker={onOpenWorker} />;
    case 'agentResult':
      return <AgentResultRow row={row} first={first} last={last} />;
    case 'progress':
      return (
        <Row node={<Node kind="progress" />} first={first} last={last}>
          <div className="flex min-h-[30px] items-start gap-3 pt-[5px]">
            <p className="min-w-0 flex-1 text-[14.5px] leading-snug text-fg-subtle">
              <span className="mr-2 font-mono text-[11.5px] tracking-[0.03em] text-violet/75">
                {row.agent}
              </span>
              <span className="italic">{row.text}</span>
            </p>
            <Type>tool_progress</Type>
          </div>
        </Row>
      );
  }
}

function AgentRow({
  row,
  first,
  last,
  onOpenWorker,
}: {
  readonly row: Extract<MockRow, { kind: 'agent' }>;
  readonly first: boolean;
  readonly last: boolean;
  readonly onOpenWorker: (agent: string) => void;
}) {
  const others = row.together.join(' and ');
  const note =
    row.state === 'working' && row.joined
      ? `Steers ${row.agent}’s current work. One result will answer this and ${others}.`
      : row.state === 'answered' && row.together.length > 0
        ? `One result answered this and ${others}.`
        : null;
  return (
    <Row
      node={
        <Node
          kind={
            row.state === 'working' ? 'agentLive' : row.state === 'failed' ? 'agentFailed' : 'agent'
          }
        />
      }
      first={first}
      last={last}
      current={row.state === 'working'}
    >
      <Head type={`tool_call · ${row.handle}`}>
        <span className="text-fg-subtle">Handed to</span>
        <button
          type="button"
          onClick={() => onOpenWorker(row.agent)}
          className="-mx-1 cursor-pointer rounded-sm px-1 font-semibold text-fg underline decoration-line/60 decoration-dotted underline-offset-4 hover:decoration-violet focus-visible:outline-2 focus-visible:outline-blue"
        >
          {row.agent}
        </button>
        <span className="font-mono text-[11.5px] tracking-[0.03em] text-fg-subtle">
          {row.agentType}
        </span>
        {row.state === 'working' && (
          <Chip tone="violet" live>
            Working
          </Chip>
        )}
        {row.state === 'failed' && <Chip tone="red">Failed</Chip>}
      </Head>
      <p className="mt-0.5 rounded-[6px_16px_16px_16px] border border-violet/20 bg-violet/[0.05] px-3.5 py-2.5 text-[15px] leading-normal text-fg-muted">
        {row.message}
      </p>
      {note && <p className="mt-1.5 text-[13.5px] text-fg-subtle">{note}</p>}
    </Row>
  );
}

/** What the model read back from the worker: collapsed to a preview, expandable to every message. */
/** What the model read back from the worker, at the point in the log where it read it. */
function AgentResultRow({
  row,
  first,
  last,
}: {
  readonly row: Extract<MockRow, { kind: 'agentResult' }>;
  readonly first: boolean;
  readonly last: boolean;
}) {
  const { outcome } = row;
  const failed = outcome._tag === 'error';
  return (
    <Row node={<Node kind={failed ? 'resultFailed' : 'result'} />} first={first} last={last}>
      <Head type={`${failed ? 'tool_errored' : 'tool_result'} · ${row.handles.join(' ')}`}>
        <span className={failed ? 'font-semibold text-red' : 'text-fg-subtle'}>
          {failed ? 'Stopped with an error:' : 'Returned from'}
        </span>
        <span className="font-semibold text-fg">{row.agent}</span>
        <span className="font-mono text-[11.5px] tracking-[0.03em] text-fg-subtle">
          {row.agentType}
        </span>
        {row.handles.length > 1 && (
          <span className="font-mono text-[11.5px] text-fg-subtle">
            answers {row.handles.join(' + ')}
          </span>
        )}
      </Head>
      {outcome._tag === 'result' ? (
        <ResultMessages messages={outcome.messages} />
      ) : (
        <>
          <p className="mt-0.5 rounded-md border border-red/25 bg-red/6 px-3.5 py-2 text-[14px] text-fg-muted">
            {outcome.error}
          </p>
          {outcome.written !== null && <WhatItWrote text={outcome.written} />}
        </>
      )}
    </Row>
  );
}

const card = 'mt-0.5 rounded-[6px_16px_16px_16px] border border-line/35 bg-elevated/40';

/** The last message (usually the conclusion), with every message behind "Show all". Fades only when it is cut. */
function ResultMessages({ messages }: { readonly messages: ReadonlyArray<string> }) {
  const [open, setOpen] = useState(false);
  const count = messages.length;
  const more = count > 1;
  const preview = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = preview.current;
    setClipped(!open && el !== null && el.scrollHeight > el.clientHeight + 1);
  }, [open, messages]);
  if (count === 0) return null;
  return (
    <div className={card}>
      <div
        ref={preview}
        className={`relative px-4 pt-3 ${open || !more ? 'pb-1' : 'max-h-72 overflow-hidden'}`}
      >
        {more && !open && (
          <p className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.06em] text-fg-subtle uppercase">
            Last of {count} messages
          </p>
        )}
        <div className="flex flex-col gap-3 divide-y divide-line/20 [&>*]:pb-3">
          {(open ? messages : messages.slice(-1)).map((text, i) => (
            <Prose key={i} text={text} />
          ))}
        </div>
        {clipped && <Fade />}
      </div>
      {more && (
        <Toggle open={open} onToggle={() => setOpen(!open)}>
          {open ? 'Show less' : `Show all ${count} messages`}
        </Toggle>
      )}
    </div>
  );
}

/** Everything a failed worker wrote before stopping, as one block: the joined text cannot be split into messages. */
function WhatItWrote({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${card} mt-2`}>
      {open && (
        <div className="px-4 pt-3 pb-1 [&>*]:pb-3">
          <Prose text={text} />
        </div>
      )}
      <Toggle open={open} onToggle={() => setOpen(!open)} rounded={open ? 'bottom' : 'all'}>
        {open ? 'Show less' : 'Show what it wrote'}
      </Toggle>
    </div>
  );
}

function Toggle({
  open,
  onToggle,
  rounded = 'bottom',
  children,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly rounded?: 'bottom' | 'all';
  readonly children: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left font-mono text-[12px] text-fg-muted hover:bg-elevated/40 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${rounded === 'all' ? 'rounded-[6px_16px_16px_16px]' : 'rounded-b-[16px] border-t border-line/25'}`}
    >
      <ChevronDown
        size={14}
        strokeWidth={1.8}
        aria-hidden
        className={`transition-transform duration-(--duration-ui) ease-expo ${open ? 'rotate-180' : ''}`}
      />
      {children}
    </button>
  );
}

function Fade() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-[#30344a] to-transparent"
    />
  );
}

function Row({
  node,
  first,
  last,
  turn = false,
  current = false,
  style,
  children,
}: {
  readonly node: ReactNode;
  readonly first: boolean;
  readonly last: boolean;
  readonly turn?: boolean;
  readonly current?: boolean;
  readonly style?: CSSProperties;
  readonly children: ReactNode;
}) {
  return (
    <li
      data-current={current}
      style={style}
      className={`relative grid grid-cols-[30px_minmax(0,1fr)] gap-x-3.5 pb-3 ${turn && !first ? 'mt-3.5' : ''}`}
    >
      <span
        aria-hidden
        className={`absolute left-[14.5px] w-px bg-line/40 ${first ? 'top-[15px]' : 'top-0'} ${last ? 'h-[15px]' : 'bottom-0'}`}
      />
      {node}
      <div className="min-w-0">{children}</div>
    </li>
  );
}

function Head({ type, children }: { readonly type?: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] flex-wrap items-center gap-2 text-sm">
      {children}
      {type && <Type>{type}</Type>}
    </div>
  );
}

function Type({ children }: { readonly children: string }) {
  return (
    <span className="ml-auto pt-0 font-mono text-[11px] text-fg-subtle/75 max-sm:hidden">
      {children}
    </span>
  );
}

type NodeKind =
  | 'result'
  | 'resultFailed'
  | 'you'
  | 'speaker'
  | 'continued'
  | 'interrupted'
  | 'agent'
  | 'agentLive'
  | 'agentFailed'
  | 'progress';

function Node({ kind }: { readonly kind: NodeKind }) {
  const base =
    'relative z-10 grid size-[30px] place-items-center rounded-full font-display text-xs font-semibold';
  switch (kind) {
    case 'you':
      return (
        <span
          aria-hidden
          className={`${base} bg-elevated text-fg-muted shadow-[0_0_0_1px_rgb(91_96_120/0.6)]`}
        >
          <User size={14} strokeWidth={1.8} />
        </span>
      );
    case 'speaker':
      return (
        <span
          aria-hidden
          className={`${base} bg-[color-mix(in_srgb,var(--sc)_18%,var(--color-canvas))] text-(--sc) shadow-[0_0_0_1px_color-mix(in_srgb,var(--sc)_45%,transparent)]`}
        >
          {SPEAKER.name[0]}
        </span>
      );
    case 'continued':
      return (
        <span aria-hidden className={base}>
          <i className="size-[7px] rounded-full bg-[color-mix(in_srgb,var(--sc)_55%,var(--color-line))]" />
        </span>
      );
    case 'interrupted':
      return (
        <span
          aria-hidden
          className={`${base} bg-amber/14 text-amber shadow-[0_0_0_1px_rgb(245_169_127/0.45)]`}
        >
          <Square size={11} fill="currentColor" strokeWidth={0} />
        </span>
      );
    case 'agent':
      return (
        <span
          aria-hidden
          className={`${base} bg-violet/10 text-violet/80 shadow-[0_0_0_1px_rgb(198_160_246/0.35)]`}
        >
          <SquareTerminal size={14} strokeWidth={1.8} />
        </span>
      );
    case 'agentLive':
      return (
        <span
          aria-hidden
          className={`${base} bg-violet/14 text-violet shadow-[0_0_0_1px_var(--color-violet),0_0_14px_rgb(198_160_246/0.5)]`}
        >
          <SquareTerminal size={14} strokeWidth={1.8} />
        </span>
      );
    case 'agentFailed':
      return (
        <span
          aria-hidden
          className={`${base} bg-red/14 text-red shadow-[0_0_0_1px_rgb(237_135_150/0.45)]`}
        >
          <SquareTerminal size={14} strokeWidth={1.8} />
        </span>
      );
    case 'result':
      return (
        <span
          aria-hidden
          className={`${base} bg-canvas text-violet shadow-[0_0_0_1px_rgb(198_160_246/0.45)]`}
        >
          <CornerDownRight size={14} strokeWidth={1.8} />
        </span>
      );
    case 'resultFailed':
      return (
        <span
          aria-hidden
          className={`${base} bg-red/14 text-red shadow-[0_0_0_1px_rgb(237_135_150/0.45)]`}
        >
          <CornerDownRight size={14} strokeWidth={1.8} />
        </span>
      );
    case 'progress':
      return (
        <span aria-hidden className={base}>
          <i className="size-[7px] rounded-full bg-violet/45" />
        </span>
      );
  }
}
