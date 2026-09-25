import { CircleAlert, Ellipsis, Square, User } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';

import { Chip, useReducedMotion } from '../ui';
import { SPEAKER_TONES, type TimelineRow } from './presentation';

/** Every action up to the cursor as one timeline row. The raw action type sits on the right of each row. */
export function Transcript({
  rows,
  visible,
}: {
  readonly rows: readonly TimelineRow[];
  readonly visible: boolean;
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
      <ol aria-label="Transcript" className="mx-auto max-w-170">
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
}: {
  readonly row: TimelineRow;
  readonly first: boolean;
  readonly last: boolean;
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
            <span className="font-semibold text-amber">You interrupted</span>
          </Head>
          <p className="text-[14.5px] text-fg-muted">Lines that hadn’t played yet were dropped.</p>
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
  return <span className="ml-auto pt-0 font-mono text-[11px] text-fg-subtle/75">{children}</span>;
}

type NodeKind = 'you' | 'speaker' | 'continued' | 'interrupted' | 'failed' | 'pending';

function Node({
  kind,
  initial,
  current = false,
}: {
  readonly kind: NodeKind;
  readonly initial?: string;
  readonly current?: boolean;
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
  }
}
