import { useAtomValue, useAtomSet } from '@effect/atom-react';
import {
  ChevronDown,
  CircleAlert,
  CircleHelp,
  CornerDownRight,
  Ellipsis,
  OctagonX,
  Square,
  SquareTerminal,
  TriangleAlert,
  User,
} from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { ShowFormat, ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import {
  AskCard,
  AskCardTitle,
  FORMAT_NODE,
  FormatIcon,
  ShowBodyView,
  ShowCard,
  ShowCardTitle,
} from '../tools';
import { Chip, Prose, useReducedMotion } from '../ui';
import { SPEAKER_TONES, type TimelineRow } from './presentation';
import { bodyOf, showPanelAtom, showRenderAtom } from './shows';

/** Every action up to the cursor as one timeline row. The raw action type sits on the right of each row. */
export function Transcript({
  rows,
  visible,
  onOpenWorker,
}: {
  readonly rows: readonly TimelineRow[];
  readonly visible: boolean;
  /** Opens the Worker layer. */
  readonly onOpenWorker: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = scroller.current;
    if (!el || !visible) return;
    const current = el.querySelector('[data-current="true"]');
    if (current) current.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    else el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [rows, visible, reduced]);

  return (
    <div
      ref={scroller}
      className="absolute inset-0 overflow-y-auto px-4 pt-2 pb-6 [mask-image:linear-gradient(transparent,#000_28px)]"
    >
      <ol aria-label="Transcript" className="mx-auto max-w-220">
        {rows.length === 0 ? (
          <Row node={<Node kind="you" />} first last>
            <Head>
              <span className="text-fg-subtle">
                Nothing here yet. What you ask, and everything said back, lands here.
              </span>
            </Head>
          </Row>
        ) : (
          rows.map((row, i) => (
            <TimelineItem
              key={row.kind === 'pending' ? 'pending' : row.id}
              row={row}
              first={i === 0}
              last={i === rows.length - 1}
              visible={visible}
              onOpenWorker={onOpenWorker}
            />
          ))
        )}
      </ol>
    </div>
  );
}

function TimelineItem({
  row,
  first,
  last,
  visible,
  onOpenWorker,
}: {
  readonly row: TimelineRow;
  readonly first: boolean;
  readonly last: boolean;
  /** The transcript layer is showing: miniatures may mount. */
  readonly visible: boolean;
  readonly onOpenWorker: () => void;
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
      const tone = { '--sc': `var(--color-${SPEAKER_TONES[row.tone]})` } as CSSProperties;
      const current = row.now !== null;
      const chips = (
        <>
          {row.interrupted && <Chip tone="amber">Interrupted</Chip>}
          {row.now === 'playing' && (
            <Chip tone="blue" live>
              Now playing
            </Chip>
          )}
          {row.now === 'audioFailed' && <Chip tone="red">Audio failed</Chip>}
          {row.now === 'held' && <Chip tone="subtle">Tap to resume</Chip>}
        </>
      );
      const text = (
        <p className={`pt-0.5 text-[17px] leading-normal ${current ? 'text-fg' : 'text-fg-muted'}`}>
          {row.text} <span className="ml-1 inline-flex gap-1.5">{chips}</span>
        </p>
      );
      return row.continued ? (
        <Row
          node={<Node kind="continued" current={current} />}
          first={first}
          last={last}
          style={tone}
          current={current}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">{text}</div>
            <Type>speak</Type>
          </div>
        </Row>
      ) : (
        <Row
          node={<Node kind="speaker" initial={row.speaker.name[0] ?? '?'} current={current} />}
          first={first}
          last={last}
          style={tone}
          current={current}
        >
          <Head type="speak">
            <span className="font-semibold text-fg">{row.speaker.name}</span>
            <span className="font-mono text-[11.5px] tracking-[0.03em] text-fg-subtle">
              {row.speaker.id}
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
    case 'failed':
      return (
        <Row node={<Node kind="failed" />} first={first} last={last}>
          <Head type="generation_failed">
            <span className="font-semibold text-red">Response cut off</span>
          </Head>
          <p className="text-[14.5px] text-fg-muted">
            {row.message} Retry to continue from the last line.{' '}
            <code className="rounded-[6px] bg-scrim/40 px-1.5 py-px font-mono text-xs text-fg-subtle">
              {row.tag}
            </code>
          </p>
        </Row>
      );
    case 'show':
      return (
        <Row
          node={<Node kind="show" format={row.input.format} failed={row.failure !== null} />}
          first={first}
          last={last}
        >
          <Head type={`tool_call · ${row.handle}`}>
            <ShowCardTitle input={row.input} failure={row.failure} corrects={row.corrects} />
          </Head>
          <ShowRowCard
            handle={row.handle}
            input={row.input}
            failure={row.failure}
            visible={visible}
          />
        </Row>
      );
    case 'ask':
      return (
        <Row
          node={<Node kind="ask" current={row.state === 'live'} />}
          first={first}
          last={last}
          current={row.state === 'live'}
        >
          <Head type={`tool_call · ${row.handle}`}>
            <AskCardTitle input={row.input} state={row.state} />
          </Head>
          <AskCard input={row.input} answer={row.answer} />
        </Row>
      );
    case 'forward':
      return <ForwardRow row={row} first={first} last={last} onOpenWorker={onOpenWorker} />;
    case 'forwardResult':
      return <ForwardResultRow row={row} first={first} last={last} />;
    case 'progress':
      return (
        <Row node={<Node kind="progress" />} first={first} last={last}>
          <div className="flex min-h-[30px] items-start gap-3 pt-[5px]">
            <p className="min-w-0 flex-1 text-[14.5px] leading-snug text-fg-subtle">
              <span className="mr-2 font-mono text-[11.5px] tracking-[0.03em] text-violet/75">
                Worker
              </span>
              <span className="italic">{row.text}</span>
            </p>
            <Type>tool_progress</Type>
          </div>
        </Row>
      );
    case 'invalidCall':
      return (
        <Row node={<Node kind="invalid" />} first={first} last={last}>
          <Head type={`tool_call · ${row.handle}`}>
            <span className="font-semibold text-amber">Invalid tool call</span>
            <code className="rounded-[6px] bg-scrim/40 px-1.5 py-px font-mono text-xs text-fg-muted">
              {row.tool}
            </code>
          </Head>
          {row.error !== null && (
            <p className="text-[14.5px] text-fg-muted">
              {row.error}{' '}
              {row.correction !== null && (
                <span className="text-fg-subtle">
                  {row.correction === 'sent'
                    ? 'Sent back to the model to correct.'
                    : 'Going back to the model to correct.'}
                </span>
              )}
            </p>
          )}
        </Row>
      );
    case 'faulted':
      return (
        <Row node={<Node kind="faulted" />} first={first} last={last} turn>
          <Head type="tool_faulted">
            <span className="font-semibold text-red">Stopped: a tool failed</span>
          </Head>
          <p className="rounded-md border border-red/25 bg-red/6 px-3.5 py-2.5 text-[14.5px] text-fg-muted">
            {row.message} Nothing more will be said. Restart the backend to begin again.
          </p>
        </Row>
      );
    case 'pending':
      return (
        <Row node={<Node kind="pending" />} first={first} last={last} pending>
          <Head>
            <span className="text-fg-muted">{row.label}</span>
          </Head>
        </Row>
      );
  }
}

/** The listener's words forwarded to the worker. "Worker" opens the Worker layer. */
function ForwardRow({
  row,
  first,
  last,
  onOpenWorker,
}: {
  readonly row: Extract<TimelineRow, { kind: 'forward' }>;
  readonly first: boolean;
  readonly last: boolean;
  readonly onOpenWorker: () => void;
}) {
  const others = row.together.join(' and ');
  const note =
    row.state === 'working' && row.joined
      ? `Steers the current work. One result will answer this and ${others}.`
      : row.state === 'answered' && row.together.length > 0
        ? `One result answered this and ${others}.`
        : null;
  return (
    <Row
      node={
        <Node
          kind={
            row.state === 'working'
              ? 'forwardLive'
              : row.state === 'failed'
                ? 'forwardFailed'
                : 'forward'
          }
        />
      }
      first={first}
      last={last}
    >
      <Head type={`tool_call · ${row.handle}`}>
        <span className="text-fg-subtle">Forwarded to the</span>
        <WorkerLink onOpenWorker={onOpenWorker} />
        {row.state === 'working' && (
          <Chip tone="violet" live>
            Working
          </Chip>
        )}
        {row.state === 'failed' && <Chip tone="red">Failed</Chip>}
      </Head>
      {note && <p className="mt-0.5 text-[13.5px] text-fg-subtle">{note}</p>}
    </Row>
  );
}

/** "Worker", as a link that opens the Worker layer. */
function WorkerLink({ onOpenWorker }: { readonly onOpenWorker: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenWorker}
      className="-mx-1 cursor-pointer rounded-sm px-1 font-semibold text-fg underline decoration-line/60 decoration-dotted underline-offset-4 hover:decoration-violet focus-visible:outline-2 focus-visible:outline-blue"
    >
      Worker
    </button>
  );
}

/** What the model read back from the worker, at the point in the log where it read it. */
function ForwardResultRow({
  row,
  first,
  last,
}: {
  readonly row: Extract<TimelineRow, { kind: 'forwardResult' }>;
  readonly first: boolean;
  readonly last: boolean;
}) {
  const { outcome } = row;
  const failed = outcome._tag === 'error';
  return (
    <Row node={<Node kind={failed ? 'resultFailed' : 'result'} />} first={first} last={last}>
      <Head type={`${failed ? 'tool_errored' : 'tool_result'} · ${row.handles.join(' ')}`}>
        <span className={failed ? 'font-semibold text-red' : 'text-fg-subtle'}>
          {failed ? 'Stopped with an error' : 'Returned from the'}
        </span>
        {!failed && <span className="font-semibold text-fg">Worker</span>}
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

const resultCard = 'mt-0.5 rounded-[6px_16px_16px_16px] border border-line/35 bg-elevated/40';

/** The last message (usually the conclusion), with every message behind "Show all". Fades only when it is cut. */
function ResultMessages({ messages }: { readonly messages: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const count = messages.length;
  const more = count > 1;
  const preview = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  // Measured after layout, so the fade appears only when the preview really is cut.
  useLayoutEffect(() => {
    const el = preview.current;
    setClipped(!open && el !== null && el.scrollHeight > el.clientHeight + 1);
  }, [open, messages]);
  if (count === 0) return null;
  return (
    <div className={resultCard}>
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
            <Prose key={i} source={text} compact />
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

/** Everything the worker wrote before it stopped, as one block: the joined text cannot be split into messages. */
function WhatItWrote({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${resultCard} mt-2`}>
      {open && (
        <div className="px-4 pt-3 pb-1 [&>*]:pb-3">
          <Prose source={text} compact />
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

/** A Show's card. Clicking its miniature reopens this exact Show in the panel; nothing runs or reports again. */
function ShowRowCard({
  handle,
  input,
  failure,
  visible,
}: {
  readonly handle: string;
  readonly input: ShowInput;
  readonly failure: string | null;
  readonly visible: boolean;
}) {
  const setPanel = useAtomSet(showPanelAtom);
  return (
    <ShowCard
      input={input}
      failure={failure}
      active={visible}
      miniature={<Miniature handle={handle} input={input} />}
      onOpen={() => setPanel({ open: true, handle })}
    />
  );
}

/** Reads the Show's one shared render; mounted only once the miniature is near the viewport. */
function Miniature({ handle, input }: { readonly handle: string; readonly input: ShowInput }) {
  const body = bodyOf(useAtomValue(showRenderAtom(handle)));
  return <ShowBodyView input={input} body={body} />;
}

function Row({
  node,
  first,
  last,
  turn = false,
  pending = false,
  current = false,
  style,
  children,
}: {
  readonly node: ReactNode;
  readonly first: boolean;
  readonly last: boolean;
  readonly turn?: boolean;
  readonly pending?: boolean;
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
        className={`absolute left-[14.5px] w-px ${first ? 'top-[15px]' : 'top-0'} ${last ? 'h-[15px]' : 'bottom-0'} ${pending ? 'border-l border-dashed border-violet/50' : 'bg-line/40'}`}
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
  | 'you'
  | 'speaker'
  | 'continued'
  | 'interrupted'
  | 'failed'
  | 'pending'
  | 'show'
  | 'ask'
  | 'invalid'
  | 'faulted'
  | 'forward'
  | 'forwardLive'
  | 'forwardFailed'
  | 'result'
  | 'resultFailed'
  | 'progress';

function Node({
  kind,
  initial,
  current = false,
  format = 'markdown',
  failed = false,
}: {
  readonly kind: NodeKind;
  readonly initial?: string;
  readonly current?: boolean;
  readonly format?: ShowFormat;
  readonly failed?: boolean;
}) {
  const base =
    'relative z-10 grid size-[30px] place-items-center rounded-full font-display text-xs font-semibold';
  const glow = current
    ? 'shadow-[0_0_0_1px_var(--sc),0_0_14px_color-mix(in_srgb,var(--sc)_60%,transparent)]'
    : '';
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
          className={`${base} bg-[color-mix(in_srgb,var(--sc)_18%,var(--color-canvas))] text-(--sc) ${glow || 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--sc)_45%,transparent)]'}`}
        >
          {initial}
        </span>
      );
    case 'continued':
      return (
        <span aria-hidden className={`${base}`}>
          <i
            className={`size-[7px] rounded-full bg-[color-mix(in_srgb,var(--sc)_55%,var(--color-line))] ${glow}`}
          />
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
    case 'failed':
      return (
        <span
          aria-hidden
          className={`${base} bg-red/14 text-red shadow-[0_0_0_1px_rgb(237_135_150/0.45)]`}
        >
          <CircleAlert size={14} strokeWidth={1.8} />
        </span>
      );
    case 'pending':
      return (
        <span
          aria-hidden
          className={`${base} bg-violet/12 text-violet shadow-[0_0_0_1px_rgb(198_160_246/0.4)] motion-safe:animate-breathe`}
        >
          <Ellipsis size={14} strokeWidth={1.8} />
        </span>
      );
    case 'show':
      return (
        <span
          aria-hidden
          className={`${base} ${failed ? 'bg-red/10 text-red/80 shadow-[0_0_0_1px_rgb(237_135_150/0.35)]' : FORMAT_NODE[format]}`}
        >
          <FormatIcon format={format} size={13} />
        </span>
      );
    case 'ask':
      return (
        <span
          aria-hidden
          className={`${base} bg-cyan/12 text-cyan ${current ? 'shadow-[0_0_0_1px_var(--color-cyan),0_0_14px_rgb(145_215_227/0.5)]' : 'shadow-[0_0_0_1px_rgb(145_215_227/0.4)]'}`}
        >
          <CircleHelp size={14} strokeWidth={1.8} />
        </span>
      );
    case 'invalid':
      return (
        <span
          aria-hidden
          className={`${base} bg-amber/10 text-amber shadow-[0_0_0_1px_rgb(245_169_127/0.35)]`}
        >
          <TriangleAlert size={13} strokeWidth={1.8} />
        </span>
      );
    case 'faulted':
      return (
        <span
          aria-hidden
          className={`${base} bg-red/16 text-red shadow-[0_0_0_1px_rgb(237_135_150/0.55)]`}
        >
          <OctagonX size={14} strokeWidth={1.8} />
        </span>
      );
    case 'forward':
      return (
        <span
          aria-hidden
          className={`${base} bg-violet/10 text-violet/80 shadow-[0_0_0_1px_rgb(198_160_246/0.35)]`}
        >
          <SquareTerminal size={14} strokeWidth={1.8} />
        </span>
      );
    case 'forwardLive':
      return (
        <span
          aria-hidden
          className={`${base} bg-violet/14 text-violet shadow-[0_0_0_1px_var(--color-violet),0_0_14px_rgb(198_160_246/0.5)]`}
        >
          <SquareTerminal size={14} strokeWidth={1.8} />
        </span>
      );
    case 'forwardFailed':
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
