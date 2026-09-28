// MOCK ONLY (story #4). Open with `?mock=workers`. Presentation only: no backend, no client, invented data. It shows the
// final designs of program-design §9 and is removed before merge.
// Uses the real Button, Kbd, RadioMenu, Composer, Dock, Visual and Subtitle so what you see is what ships.

import { useAtom, useAtomValue } from '@effect/atom-react';
import {
  PanelRight,
  SlidersHorizontal,
  SquareTerminal,
  TextAlignStart,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Composer } from '../../conversation';
import { Subtitle } from '../../playback';
import { Button, Kbd, RadioMenu, typingTarget, useReducedMotion } from '../../ui';
import { createAnalysis, Visual, VISUAL_IDS, VISUAL_NAMES, VisualSwatch } from '../../visuals';
import { Dock } from '../Dock';
import { visualAtom } from '../state';
import { LIVE_APPEND, MOCK_STATES, type MockState, sceneFor } from './fixtures';
import { MockTranscript } from './MockTranscript';
import { TRANSCRIPT_SCENES, type TranscriptScene, transcriptSceneFor } from './transcriptScenes';
import { WorkersLayer } from './WorkersLayer';

import './mocks.css';

const analysis = createAnalysis();
const icon = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const;

type Layer = 'stage' | 'transcript' | 'workers';

/** Which worker state each main-transcript scene implies, so both layers tell the same story. */
const WORKER_STATE_FOR: Record<TranscriptScene, MockState> = {
  working: 'working',
  interruptedWait: 'working',
  steered: 'working',
  answered: 'done',
  failed: 'failed',
};

const param = (name: string) => new URLSearchParams(window.location.search).get(name);

export function MockApp() {
  const [state, setState] = useState<MockState>(
    () => (param('state') as MockState | null) ?? 'working',
  );
  const [tScene, setTScene] = useState<TranscriptScene>(
    () => (param('t') as TranscriptScene | null) ?? 'working',
  );
  const [layer, setLayer] = useState<Layer>(() => (param('t') ? 'transcript' : 'workers'));
  const transcript = useMemo(() => transcriptSceneFor(tScene), [tScene]);
  const scene = useMemo(() => sceneFor(state), [state]);
  // A simulated newer agent call: which worker it went to. It changes "latest" but never the open view.
  const [called, setCalled] = useState<string | null>(null);
  const latest = called ?? scene.latest;
  // Entries the working worker has written since the scene started ("Worker writes more").
  const [written, setWritten] = useState(0);
  const view = useMemo(
    () => ({
      ...scene,
      latest,
      transcripts:
        written === 0
          ? scene.transcripts
          : {
              ...scene.transcripts,
              brainstorm: [
                ...(scene.transcripts['brainstorm'] ?? []),
                ...LIVE_APPEND.slice(0, written),
              ],
            },
      workers: scene.workers.map((w) =>
        w.agent === called ? { ...w, status: 'working' as const } : w,
      ),
    }),
    [scene, latest, called, written],
  );
  const [selected, setSelected] = useState<string | null>(scene.latest);
  const latestRef = useRef(latest);
  latestRef.current = latest;
  // Set when the layer is opened from an agent row: that worker, not the latest.
  const requested = useRef<string | null>(null);
  // A new scene resets the mock.
  useEffect(() => {
    setCalled(null);
    setWritten(0);
    setSelected(scene.latest);
  }, [scene]);
  // Opening the layer selects the latest worker; while it is open, the selection stays put.
  useEffect(() => {
    if (layer === 'workers') setSelected(requested.current ?? latestRef.current);
    requested.current = null;
  }, [layer]);
  // The status line's "Thinking" clock counts from an Agent execution that started 3:12 ago.
  const [since] = useState(() => Date.now() - 192_000);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('state', state);
    url.searchParams.set('t', tScene);
    window.history.replaceState(null, '', url);
  }, [state, tScene]);

  // Layer switching, with focus following the rule in program-design §9.3: if the focused element is in the layer being
  // hidden (it becomes inert), focus moves to the shown layer's heading; focus elsewhere, such as a top-bar button,
  // stays put. Closing from the layer's own close button returns focus to the top-bar Workers button.
  const sections = useRef<Record<Layer, HTMLElement | null>>({
    stage: null,
    transcript: null,
    workers: null,
  });
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const pendingFocus = useRef<'heading' | 'workersButton' | null>(null);
  const switchLayer = useCallback((next: Layer, returnToWorkersButton = false) => {
    const from = sections.current[layerRef.current];
    const active = document.activeElement;
    const hidesFocus = from !== null && active !== null && from.contains(active);
    pendingFocus.current = returnToWorkersButton ? 'workersButton' : hidesFocus ? 'heading' : null;
    setLayer(next);
  }, []);
  // Runs right after the layer change reaches the DOM. The shown layer is focusable at once because its visibility
  // flips without a transition (see `layerClass`); only the hidden layer keeps visibility through its fade-out.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === 'workersButton') {
      document.querySelector<HTMLElement>('header button[aria-label="Workers"]')?.focus();
    } else if (target === 'heading') {
      const shown = sections.current[layer];
      (shown?.querySelector<HTMLElement>('[data-layer-heading]') ?? shown)?.focus();
    }
  }, [layer]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.repeat ||
        typingTarget(event.target)
      )
        return;
      const key = event.key.toLowerCase();
      if (key === 'w' || key === 'e') {
        event.preventDefault();
        const target: Layer = key === 'w' ? 'workers' : 'transcript';
        switchLayer(layerRef.current === target ? 'stage' : target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switchLayer]);

  const onTranscript = layer === 'transcript';
  const thinking = onTranscript
    ? transcript.footer.thinking
    : state !== 'done' && state !== 'failed' && state !== 'empty';
  const idleCopy = onTranscript ? transcript.footer.copy : 'Your turn.';
  const workersOpen = layer === 'workers';
  const stageOpen = layer === 'stage';
  const layerClass = 'absolute inset-0 duration-(--duration-surface) ease-expo';
  // Showing: visibility flips at once (so focus can land) and only opacity fades. Hiding: visibility waits for the fade.
  const shown = (open: boolean) =>
    open
      ? 'visible opacity-100 transition-opacity'
      : 'invisible opacity-0 transition-[opacity,visibility]';

  return (
    <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="col-start-1 row-start-1">
        <MockTopBar
          workersOpen={workersOpen}
          transcriptOpen={onTranscript}
          onWorkers={() => switchLayer(workersOpen ? 'stage' : 'workers')}
          onTranscript={() => switchLayer(onTranscript ? 'stage' : 'transcript')}
        />
      </div>
      <main className="relative col-start-1 row-start-2 flex min-h-0 max-sm:overflow-hidden">
        <div className="relative min-w-0 flex-1">
          <section
            aria-label="Now playing"
            ref={(el) => {
              sections.current.stage = el;
            }}
            tabIndex={-1}
            inert={!stageOpen}
            className={`${layerClass} flex flex-col items-center justify-center px-6 outline-none pb-2 max-sm:px-4 ${shown(stageOpen)}`}
          >
            <MockStage active={stageOpen} thinking={thinking} />
          </section>
          <section
            aria-label="Transcript"
            ref={(el) => {
              sections.current.transcript = el;
            }}
            inert={!onTranscript}
            className={`${layerClass} ${shown(onTranscript)}`}
          >
            <h2 tabIndex={-1} data-layer-heading className="sr-only">
              Transcript
            </h2>
            <MockTranscript
              rows={transcript.rows}
              onOpenWorker={(agent) => {
                requested.current = agent;
                switchLayer('workers');
              }}
            />
          </section>
          <section
            aria-label="Workers"
            ref={(el) => {
              sections.current.workers = el;
            }}
            inert={!workersOpen}
            className={`${layerClass} ${shown(workersOpen)}`}
          >
            <WorkersLayer
              scene={view}
              open={workersOpen}
              selected={selected}
              onSelect={(agent) => {
                if (state === 'notFound') setState('working');
                setSelected(agent);
              }}
              onClose={() => switchLayer('stage', true)}
            />
          </section>
        </div>
      </main>
      <footer className="relative z-20 col-start-1 row-start-3 px-4 pt-3 pb-5 max-sm:px-3 max-sm:pt-2.5 max-sm:pb-3">
        <div className="mb-3.5 max-sm:mb-2.5">
          <MockStatusLine thinking={thinking} since={since} copy={idleCopy} />
        </div>
        <Dock shape="composer" contentKey="composer">
          <Composer
            mode={thinking ? 'busy' : 'compose'}
            onSend={() => Promise.resolve(false)}
            onInterrupt={() => undefined}
            onRetry={() => undefined}
            onRetryClip={() => undefined}
          />
        </Dock>
      </footer>
      <MockControls
        state={state}
        onState={setState}
        callTarget={view.workers.find((w) => w.agent !== latest)?.agent ?? null}
        onCall={setCalled}
        canWrite={workersOpen && state === 'working' && written < LIVE_APPEND.length}
        onWrite={() => setWritten((n) => n + 1)}
        tScene={onTranscript ? tScene : null}
        onTScene={(next) => {
          setTScene(next);
          // The worker tells the same story as the conversation.
          setState(WORKER_STATE_FOR[next]);
          switchLayer('transcript');
        }}
      />
    </div>
  );
}

function MockTopBar({
  workersOpen,
  transcriptOpen,
  onWorkers,
  onTranscript,
}: {
  readonly workersOpen: boolean;
  readonly transcriptOpen: boolean;
  readonly onWorkers: () => void;
  readonly onTranscript: () => void;
}) {
  const [visual, setVisual] = useAtom(visualAtom);
  return (
    <header className="relative z-20 flex min-h-17 items-center gap-3 px-4.5 py-3.5 max-sm:px-3">
      <div className="inline-flex items-center gap-2.5 font-display text-[15px] font-medium tracking-[-0.01em] text-fg-muted">
        <i
          aria-hidden
          className="size-2 rounded-full bg-linear-135 from-cyan to-violet shadow-[0_0_12px_rgb(145_215_227/0.5)]"
        />
        Fluidcast
      </div>
      <div className="ml-auto flex items-center gap-1.5 max-sm:gap-0.5">
        <Button
          tone="ghost"
          aria-label="Back"
          unavailable
          className="text-sm"
          icon={<Undo2 {...icon} />}
        >
          <span className="max-sm:hidden">Back</span>
          <span className="max-sm:hidden">
            <Kbd>B</Kbd>
          </span>
        </Button>
        <RadioMenu
          label="Visual"
          value={visual}
          options={VISUAL_IDS.map((id) => ({
            value: id,
            label: VISUAL_NAMES[id],
            icon: <VisualSwatch id={id} />,
          }))}
          onChange={setVisual}
          trigger={
            <>
              <VisualSwatch id={visual} />
              <span className="max-sm:hidden">{VISUAL_NAMES[visual]}</span>
            </>
          }
        />
        <Button
          tone="ghost"
          aria-label="Show"
          unavailable
          className="text-sm"
          icon={<PanelRight {...icon} />}
        >
          <span className="max-sm:hidden">Show</span>
          <span className="max-sm:hidden">
            <Kbd>S</Kbd>
          </span>
        </Button>
        <Button
          tone="ghost"
          aria-label="Transcript"
          aria-pressed={transcriptOpen}
          aria-keyshortcuts="E"
          onClick={onTranscript}
          className="text-sm"
          icon={<TextAlignStart {...icon} />}
        >
          <span className="max-sm:hidden">Transcript</span>
          <span className="max-sm:hidden">
            <Kbd>E</Kbd>
          </span>
        </Button>
        <Button
          tone="ghost"
          aria-label="Workers"
          aria-pressed={workersOpen}
          aria-keyshortcuts="W"
          className="text-sm"
          icon={<SquareTerminal {...icon} />}
          onClick={onWorkers}
        >
          <span className="max-sm:hidden">Workers</span>
          <span className="max-sm:hidden">
            <Kbd>W</Kbd>
          </span>
        </Button>
      </div>
    </header>
  );
}

function MockStage({ active, thinking }: { readonly active: boolean; readonly thinking: boolean }) {
  const reducedMotion = useReducedMotion();
  const visual = useAtomValue(visualAtom);
  const inputs = useMemo(
    () => ({
      state: thinking ? ('thinking' as const) : ('idle' as const),
      analysis,
      reducedMotion,
      held: false,
    }),
    [thinking, reducedMotion],
  );
  return (
    <>
      <div className="relative h-[clamp(250px,46vh,460px)] w-full shrink-0 max-sm:h-[clamp(170px,30vh,300px)]">
        <Visual id={visual} inputs={inputs} active={active} />
      </div>
      <div className="mt-[clamp(12px,3vh,36px)] flex w-full justify-center">
        <Subtitle
          line={{
            key: 'l',
            text: "I've asked the brainstorm worker to compare both designs. I'll tell you what it finds.",
            tone: 'dim',
          }}
        />
      </div>
    </>
  );
}

/** Re-renders every second while `on`, returning `Date.now()`. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/** `m:ss`, or `h:mm:ss` past an hour (program-design §9.1 `formatElapsed`). */
const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/** The real StatusLine's look with the final "Thinking · m:ss" copy. */
function MockStatusLine({
  thinking,
  since,
  copy,
}: {
  readonly thinking: boolean;
  readonly since: number;
  readonly copy: string;
}) {
  const now = useNow(thinking);
  const color = thinking ? 'var(--color-violet)' : 'var(--color-cyan)';
  return (
    <div
      role="status"
      className="flex min-h-[18px] items-center justify-center gap-2.5 font-mono text-xs tracking-[0.04em] text-fg-subtle"
    >
      <i
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${thinking ? 'motion-safe:animate-breathe' : ''}`}
        style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
      />
      <span>{thinking ? `Thinking · ${formatElapsed(now - since)}` : copy}</span>
    </div>
  );
}

function MockControls({
  state,
  onState,
  callTarget,
  onCall,
  canWrite,
  onWrite,
  tScene,
  onTScene,
}: {
  readonly state: MockState;
  readonly onState: (s: MockState) => void;
  readonly callTarget: string | null;
  readonly onCall: (agent: string) => void;
  readonly canWrite: boolean;
  readonly onWrite: () => void;
  readonly tScene: TranscriptScene | null;
  readonly onTScene: (scene: TranscriptScene) => void;
}) {
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  const pill = (active: boolean) =>
    `min-h-8 cursor-pointer rounded-full px-2.5 font-mono text-[11px] transition-colors duration-(--duration-ui) ${active ? 'bg-amber/20 text-amber shadow-[inset_0_0_0_1px_rgb(245_169_127/0.5)]' : 'text-fg-muted hover:bg-elevated/70'}`;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-1/2 right-0 z-50 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-l-full border border-r-0 border-amber/40 bg-scrim/85 px-3 font-mono text-[11px] text-amber backdrop-blur-xl"
      >
        <SlidersHorizontal size={13} strokeWidth={1.8} aria-hidden />
        Mock
      </button>
    );
  }
  return (
    <aside
      aria-label="Mock controls"
      className="fixed bottom-4 left-4 z-50 w-64 rounded-md border border-amber/35 bg-scrim/88 p-3 shadow-soft backdrop-blur-xl max-sm:top-auto max-sm:bottom-[150px] max-sm:left-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-amber uppercase">
          Mock
        </span>
        <button
          type="button"
          aria-label="Hide mock controls"
          onClick={() => setOpen(false)}
          className="cursor-pointer p-1 text-fg-subtle hover:text-fg"
        >
          <X size={14} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      <p className="mb-1 font-mono text-[10px] tracking-[0.06em] text-fg-subtle uppercase">
        Worker (W)
      </p>
      <div className="flex flex-wrap gap-1">
        {MOCK_STATES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onState(s.value)}
            className={pill(state === s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-3 mb-1 font-mono text-[10px] tracking-[0.06em] text-fg-subtle uppercase">
        Main transcript (E)
      </p>
      <div className="flex flex-wrap gap-1">
        {TRANSCRIPT_SCENES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onTScene(t.value)}
            className={pill(tScene === t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {(callTarget !== null || canWrite) && (
        <>
          <p className="mt-3 mb-1 font-mono text-[10px] tracking-[0.06em] text-fg-subtle uppercase">
            Simulate
          </p>
          {canWrite && (
            <button type="button" onClick={onWrite} className={`${pill(false)} w-full text-left`}>
              Worker writes more
            </button>
          )}
          {callTarget !== null && (
            <button
              type="button"
              onClick={() => onCall(callTarget)}
              className={`${pill(false)} w-full text-left`}
            >
              New agent call → {callTarget}
            </button>
          )}
          <p className="mt-1 px-2.5 text-[11px] leading-snug text-fg-subtle">
            New output follows only if you are at the bottom. A new call never changes the open
            worker; reopen (W) to land on the latest.
          </p>
        </>
      )}
    </aside>
  );
}
