import { useAtom, useAtomValue } from '@effect/atom-react';
import { Atom } from 'effect/unstable/reactivity';
import { PanelRight, TextAlignStart } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { Composer, Transcript } from '../../conversation';
import { PlayerControls, type PlayerControlsProps, Subtitle, TapToResume } from '../../playback';
import { AskForm, ShowPanel, ShowSheet, type ShownShow } from '../../tools';
import { Button, Chip, PHONE, RadioMenu, typingTarget, useMedia, useReducedMotion } from '../../ui';
import { createAnalysis, Visual } from '../../visuals';
import { Brand } from '../Brand';
import { Dock } from '../Dock';
import { visualAtom } from '../state';
import {
  CONTENT,
  type ContentId,
  type Dot,
  SCENARIOS,
  type ScenarioId,
  SHOW_BODY,
  SHOW_INPUT,
  type StatusText,
  transcriptRows,
  walkFor,
} from './fixtures';

/**
 * Temporary mock of the persistent player controls, at `/__player-controls`, outside the status gate. Presses only
 * select prepared fixtures: nothing reaches the Client, audio, generation or tools.
 */

interface MockState {
  readonly transcript: boolean;
  readonly scenario: ScenarioId;
  /** The selected position. */
  readonly content: ContentId;
  /** The furthest point reached: Back selects an earlier line without moving it. */
  readonly frontier: ContentId;
  readonly paused: boolean;
  readonly showOpen: boolean;
}

const mockAtom = Atom.make<MockState>({
  transcript: false,
  scenario: 'pausedMid',
  content: 'speechA',
  frontier: 'speechA',
  paused: true,
  showOpen: false,
});

const SHOWN: ShownShow = {
  handle: 'mock-show',
  input: SHOW_INPUT,
  body: SHOW_BODY,
  correction: null,
};

const DOT_COLOR: Record<Dot, string> = {
  blue: 'var(--color-blue)',
  violet: 'var(--color-violet)',
  cyan: 'var(--color-cyan)',
  subtle: 'var(--color-fg-subtle)',
  red: 'var(--color-red)',
};

const analysis = createAnalysis();

/** A synthetic voice so the visual moves while a fixture "plays". */
const syntheticVoice = {
  sample(now: number, out: Float32Array) {
    const level = Math.max(0, Math.sin(now / 95) * 0.5 + Math.sin(now / 410) * 0.4 + 0.2);
    for (let k = 0; k < out.length; k++) out[k] = level * Math.exp(-k / 14);
    return Math.min(1, level);
  },
};

/**
 * The live player's layer handling: a shown layer's visibility flips at once and only its opacity fades; a hidden layer
 * keeps its visibility through the fade-out. Fades stay under reduced motion.
 */
const layerClass = (open: boolean) =>
  `absolute inset-0 duration-(--duration-surface) ease-expo ${open ? 'visible opacity-100 transition-opacity' : 'invisible opacity-0 transition-[opacity,visibility]'}`;

const noSend = () => Promise.resolve(false);
const noop = () => {};

export function PlayerControlsMock() {
  const [state, setState] = useAtom(mockAtom);
  const visual = useAtomValue(visualAtom);
  const phone = useMedia(PHONE);
  const reducedMotion = useReducedMotion();
  const content = CONTENT[state.content];
  const { paused } = state;
  const speakingNow = content.visual === 'speaking' && !paused;
  // A presented Show stays presented when Back selects an earlier line.
  const showAvailable = content.show || CONTENT[state.frontier].show;
  const panelOpen = showAvailable && state.showOpen;
  const sheetCovers = phone && panelOpen;

  useEffect(() => {
    analysis.connect(speakingNow ? syntheticVoice : null);
    return () => analysis.connect(null);
  }, [speakingNow]);

  const inputs = useMemo(
    () => ({
      state: paused && content.visual === 'speaking' ? ('idle' as const) : content.visual,
      analysis,
      reducedMotion,
      held: paused && content.connected,
    }),
    [content.visual, content.connected, paused, reducedMotion],
  );

  const walk = walkFor(state.frontier);
  const at = walk?.indexOf(state.content) ?? -1;
  const backTo = walk && at > 0 ? walk[at - 1] : undefined;
  const forwardTo = walk && at >= 0 ? walk[at + 1] : undefined;
  const go = (next: ContentId) => {
    const ahead = walk !== null && walk.indexOf(next) > walk.indexOf(state.frontier);
    setState({
      ...state,
      content: next,
      frontier: ahead ? next : state.frontier,
      // Landing on a Show runs it: the panel opens, as the live player does.
      showOpen: CONTENT[next].show && !showAvailable ? true : state.showOpen,
    });
  };

  const controls: PlayerControlsProps = {
    back: {
      available: content.connected && backTo !== undefined,
      onPress: () => backTo && go(backTo),
    },
    forward: {
      available: content.connected && forwardTo !== undefined,
      onPress: () => forwardTo && go(forwardTo),
    },
    play: {
      paused: paused || !content.progressing,
      available: content.connected && (paused || content.progressing || content.startable === true),
      onPress: () => {
        if (content.startable) {
          setState({ ...state, content: 'speechA', frontier: 'speechA', paused: false });
        } else setState({ ...state, paused: !paused });
      },
    },
  };

  // B steps back, with the live player's guards: no modifiers or repeats, and never while typing or in a menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (typingTarget(event.target) || event.key.toLowerCase() !== 'b') return;
      if (!controls.back.available) return;
      event.preventDefault();
      controls.back.onPress();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Dialogue follows the selection; an Ask, running work or a failed generation still in effect keeps its status
  // while earlier lines are selected. An open question also keeps the dock, so its form stays mounted with its draft;
  // the composer follows the selection, so a replayed line offers Interrupt, never Send or Retry.
  const frontier = CONTENT[state.frontier];
  const standing = state.content !== state.frontier && frontier.standing ? frontier : content;
  const status = standing.status(paused);
  const dockContent = standing.dock.kind === 'ask' ? standing.dock : content.dock;
  const line = content.line && {
    key: `${state.content}-${content.line.text}`,
    text: content.line.text,
    tone: content.line.dim ? ('dim' as const) : ('current' as const),
    ...(paused && !content.line.dim ? { label: 'Paused' } : {}),
  };

  const asking = dockContent.kind === 'ask';
  // The accepted placement: inside the dock, in a strip under an open question.
  const dockBody =
    dockContent.kind === 'ask' ? (
      <div>
        <AskForm
          input={dockContent.input}
          mode="open"
          narrating={speakingNow}
          disabled={!content.connected}
          onSubmit={noSend}
          onInterrupt={noop}
        />
        <div className="flex justify-center border-t border-line/25 px-2 py-1">
          <PlayerControls {...controls} />
        </div>
      </div>
    ) : (
      // One Composer at a fixed place in the tree, so crossing the breakpoint keeps the draft. Wide: controls at its
      // leading edge. Phone: a strip below it, as under a question. Focus order follows what is on screen.
      <div>
        <div className="flex items-end">
          {!phone && (
            <PlayerControls {...controls} className="my-2 ml-1.5 border-r border-line/30 pr-1" />
          )}
          <div className="min-w-0 flex-1">
            <Composer
              mode={dockContent.mode}
              onSend={() => {
                // Sending starts a turn: the pause is released and the reply is being prepared.
                setState({ ...state, content: 'thinking', frontier: 'thinking', paused: false });
                return Promise.resolve(true);
              }}
              onInterrupt={noop}
              onRetry={noop}
              onRetryClip={noop}
            />
          </div>
        </div>
        {phone && (
          <div className="flex justify-center border-t border-line/25 px-2 py-1">
            <PlayerControls {...controls} />
          </div>
        )}
      </div>
    );

  return (
    <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="col-start-1 row-start-1" inert={sheetCovers}>
        <header className="relative z-20 flex min-h-17 items-center gap-3 px-4.5 py-3.5 max-sm:gap-1 max-sm:px-3">
          <Brand compact />
          <Chip tone="amber">Mock</Chip>
          <div className="ml-auto flex items-center gap-1.5 max-sm:gap-0.5">
            <RadioMenu
              label="Scenario"
              className="max-sm:px-2"
              value={state.scenario}
              options={SCENARIOS.map((s) => ({ value: s.id, label: s.label }))}
              onChange={(id) => {
                const scenario = SCENARIOS.find((s) => s.id === id)!;
                setState({
                  ...state,
                  scenario: id,
                  content: scenario.content,
                  frontier: scenario.content,
                  paused: scenario.paused,
                });
              }}
              trigger={
                <span className="max-w-[40vw] truncate text-sm">
                  {SCENARIOS.find((s) => s.id === state.scenario)!.label}
                </span>
              }
            />
            <Button
              tone="ghost"
              aria-label="Transcript"
              aria-pressed={state.transcript}
              className="text-sm max-lg:px-0"
              icon={<TextAlignStart size={16} strokeWidth={1.8} aria-hidden />}
              onClick={() => setState({ ...state, transcript: !state.transcript })}
            >
              <span className="max-lg:hidden">Transcript</span>
            </Button>
            <Button
              tone="ghost"
              aria-label="Show"
              aria-pressed={panelOpen}
              unavailable={!showAvailable}
              className="text-sm max-lg:px-0"
              icon={<PanelRight size={16} strokeWidth={1.8} aria-hidden />}
              onClick={() => setState({ ...state, showOpen: !state.showOpen })}
            >
              <span className="max-lg:hidden">Show</span>
            </Button>
          </div>
        </header>
      </div>

      <main className="relative col-start-1 row-start-2 flex min-h-0 max-sm:overflow-hidden">
        <div className="relative min-w-0 flex-1">
          <section
            aria-label="Now playing"
            inert={sheetCovers || state.transcript}
            className={`${layerClass(!state.transcript)} flex flex-col items-center justify-center px-6 pb-2 max-sm:px-4`}
          >
            <div
              className={`relative w-full shrink-0 transition-[height] duration-(--duration-room) ease-expo motion-reduce:transition-none ${panelOpen && !phone ? 'h-[clamp(160px,32vh,360px)]' : 'h-[clamp(250px,46vh,460px)] max-sm:h-[clamp(170px,30vh,300px)]'}`}
            >
              <Visual id={visual} inputs={inputs} active={!sheetCovers && !state.transcript} />
              <TapToResume
                visible={state.content === 'ready'}
                label="Tap to start"
                onActivate={controls.play.onPress}
              />
            </div>
            <div className="mt-[clamp(12px,3vh,36px)] flex w-full justify-center">
              <Subtitle line={line} />
            </div>
          </section>
          <section
            aria-label="Transcript"
            inert={sheetCovers || !state.transcript}
            className={layerClass(state.transcript)}
          >
            <Transcript
              rows={transcriptRows(state.content, state.frontier, paused)}
              visible={state.transcript && !sheetCovers}
              onOpenWorker={noop}
            />
          </section>
        </div>
        {!phone && (
          <aside
            aria-label="Show"
            inert={!panelOpen}
            className={`min-w-0 transition-[flex-basis,opacity] duration-(--duration-surface) ease-expo motion-reduce:transition-opacity ${panelOpen ? 'basis-[60%] opacity-100' : 'basis-0 opacity-0'}`}
          >
            <div
              className={`h-full min-w-[440px] pt-1 pr-4 pb-1 transition-transform duration-(--duration-surface) ease-expo motion-reduce:transition-none ${panelOpen ? 'translate-x-0' : 'translate-x-8 motion-reduce:translate-x-0'}`}
            >
              <ShowPanel show={SHOWN} onClose={() => setState({ ...state, showOpen: false })} />
            </div>
          </aside>
        )}
      </main>

      {phone && (
        <ShowSheet
          show={SHOWN}
          open={panelOpen}
          speaking={speakingNow}
          onClose={() => setState({ ...state, showOpen: false })}
        />
      )}

      <footer className="relative z-20 col-start-1 row-start-3 px-4 pt-3 pb-5 max-sm:px-3 max-sm:pt-2.5 max-sm:pb-3">
        <div className="mb-3.5 max-sm:mb-2.5">
          <StatusFixture status={status} />
        </div>
        <Dock shape={asking ? 'ask' : 'composer'} contentKey={asking ? 'ask' : 'composer'}>
          {dockBody}
        </Dock>
      </footer>
    </div>
  );
}

/** The status line's look with fixture copy, since paused copy does not exist yet. */
function StatusFixture({ status }: { readonly status: StatusText }) {
  const color = DOT_COLOR[status.dot];
  return (
    <div
      role="status"
      className={`flex min-h-[18px] items-center gap-2.5 font-mono text-xs tracking-[0.04em] text-fg-subtle justify-center text-center`}
    >
      <i
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${status.pulse ? 'motion-safe:animate-breathe' : ''} ${status.text ? '' : 'opacity-0'}`}
        style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
      />
      <span
        key={status.text}
        className={`motion-safe:animate-[status-in_var(--duration-ui)_var(--ease-expo)] ${status.dot === 'red' ? 'text-red' : ''}`}
      >
        {status.text}
      </span>
    </div>
  );
}
