import { useAtom, useAtomMount, useAtomValue } from '@effect/atom-react';
import { RotateCcw, Square } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import {
  type AskPresence,
  Composer,
  presentationAtom,
  showDriverAtom,
  showPanelAtom,
  shownShowAtom,
  StatusLine,
  Transcript,
  useConversationCommands,
} from '../conversation';
import { Subtitle, TapToResume, usePlaybackAnalyser, usePlaybackControls } from '../playback';
import { AskForm, ShowPanel, ShowSheet } from '../tools';
import { Button, PHONE, typingTarget, useMedia, useReducedMotion } from '../ui';
import { analyserSource, createAnalysis, Visual } from '../visuals';
import { WorkersLayer } from '../workers';
import { Dock } from './Dock';
import { focusTargetOnSwitch, type Layer, nextLayer } from './layers';
import { layerAtom, visualAtom } from './state';
import { TopBar } from './TopBar';

/** One analysis handle for the page. The player's analyser feeds it; visuals read it per frame. */
const analysis = createAnalysis();

const inMenu = (target: EventTarget | null) =>
  target instanceof Element && target.closest('[role="menu"]') !== null;

/** The player for one backend session. It renders inside that session's own atom registry (see `Root.tsx`). */
export function Player() {
  useAtomMount(showDriverAtom);
  const presentation = useAtomValue(presentationAtom);
  const commands = useConversationCommands();
  const playback = usePlaybackControls();
  const analyser = usePlaybackAnalyser();
  const visual = useAtomValue(visualAtom);
  const [layer, setLayer] = useAtom(layerAtom);
  const [panel, setPanel] = useAtom(showPanelAtom);
  const shown = useAtomValue(shownShowAtom);
  const reducedMotion = useReducedMotion();
  const phone = useMedia(PHONE);
  const { moment, composer, ask, interruptible, canGoBack, latestShow } = presentation;
  const transcriptOpen = layer === 'transcript';
  const workersOpen = layer === 'workers';
  const stageOpen = layer === 'stage';

  // Layer switching. Focus moves only when the focused element is inside the layer being hidden (it becomes inert):
  // to the shown layer's heading, or to the stage. The Worker close button returns focus to the top-bar Worker button.
  const sections = useRef<Record<Layer, HTMLElement | null>>({
    stage: null,
    transcript: null,
    workers: null,
  });
  const workersButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'heading' | 'workersButton' | null>(null);
  const switchLayer = useCallback(
    (next: Layer, options: { readonly viaWorkersClose?: boolean } = {}) => {
      const hidden = sections.current[layer];
      const active = document.activeElement;
      pendingFocus.current = focusTargetOnSwitch(
        layer,
        next,
        hidden !== null && active !== null && hidden.contains(active),
        options.viaWorkersClose,
      );
      setLayer(next);
    },
    [layer, setLayer],
  );
  // After the switch commits. The shown layer is focusable at once: its visibility flips without a transition.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === 'workersButton') workersButton.current?.focus();
    else if (target === 'heading') {
      const section = sections.current[layer];
      (section?.querySelector<HTMLElement>('[data-layer-heading]') ?? section)?.focus();
    }
  }, [layer]);

  const panelOpen = panel.open && shown !== null;
  // At phone width an open Show covers the top bar and the stage.
  const sheetCovers = phone && panelOpen;
  const closePanel = () => setPanel({ ...panel, open: false });
  // Opening from the top bar or `S` shows the latest Show; the transcript opens a specific one.
  const togglePanel = () =>
    setPanel(panelOpen ? { ...panel, open: false } : { open: true, handle: null });

  useEffect(() => {
    analysis.connect(analyserSource(analyser));
    return () => analysis.connect(null);
  }, [analyser]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.key === 'Escape') {
        if (interruptible && !inMenu(event.target)) {
          event.preventDefault();
          commands.interrupt();
        }
        return;
      }
      if (typingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'e' || key === 'w') {
        event.preventDefault();
        switchLayer(nextLayer(layer, key));
      } else if (key === 's' && latestShow !== null) {
        event.preventDefault();
        setPanel(panelOpen ? { ...panel, open: false } : { open: true, handle: null });
      } else if (key === 'b' && canGoBack) {
        event.preventDefault();
        commands.back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    commands,
    interruptible,
    canGoBack,
    latestShow,
    layer,
    switchLayer,
    panel,
    panelOpen,
    setPanel,
  ]);

  const inputs = useMemo(
    () => ({ state: presentation.visual, analysis, reducedMotion, held: presentation.held }),
    [presentation.visual, presentation.held, reducedMotion],
  );

  const icon = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const;
  const interruptButton = (
    <Button
      tone="quiet"
      icon={<Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />}
      onClick={commands.interrupt}
    >
      Interrupt
    </Button>
  );
  const retryClipButton = (
    <Button tone="danger" icon={<RotateCcw {...icon} />} onClick={playback.retryClip}>
      Retry clip
    </Button>
  );

  // A shown layer's visibility flips at once (so focus can land) and only its opacity fades; a hidden layer keeps its
  // visibility through the fade-out.
  const layerClass = (open: boolean) =>
    `absolute inset-0 duration-(--duration-surface) ease-expo ${open ? 'visible opacity-100 transition-opacity' : 'invisible opacity-0 transition-[opacity,visibility]'}`;
  return (
    <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="col-start-1 row-start-1" inert={sheetCovers}>
        <TopBar
          back={{ available: canGoBack, onBack: commands.back }}
          show={{ open: panelOpen, available: latestShow !== null, onToggle: togglePanel }}
          layers={{
            current: layer,
            onToggle: (target) => switchLayer(layer === target ? 'stage' : target),
            workersRef: workersButton,
          }}
          reset={{
            onReset: () => void commands.reset(),
            pending: presentation.resetPending,
            failed: presentation.status === 'resetFailed',
          }}
        />
      </div>
      <main className="relative col-start-1 row-start-2 flex min-h-0 max-sm:overflow-hidden">
        {/* The player column holds three layers: the stage, the transcript (E) and the Worker layer (W). The Show panel
            sits beside it. */}
        <div className="relative min-w-0 flex-1">
          <section
            aria-label="Now playing"
            ref={(el) => {
              sections.current.stage = el;
            }}
            tabIndex={-1}
            inert={sheetCovers || !stageOpen}
            className={`${layerClass(stageOpen)} flex flex-col items-center justify-center px-6 pb-2 outline-none max-sm:px-4`}
          >
            <div
              className={`relative w-full shrink-0 transition-[height] duration-(--duration-room) ease-expo motion-reduce:transition-none ${panelOpen && !phone ? 'h-[clamp(160px,32vh,360px)]' : 'h-[clamp(250px,46vh,460px)] max-sm:h-[clamp(170px,30vh,300px)]'}`}
            >
              <Visual id={visual} inputs={inputs} active={!sheetCovers && stageOpen} />
              <TapToResume
                visible={moment === 'held' || moment === 'ready'}
                label={moment === 'ready' ? 'Tap to start' : 'Tap to resume'}
                onActivate={moment === 'ready' ? () => void commands.start() : playback.resume}
                unavailable={moment === 'ready' && presentation.resetPending}
              />
            </div>
            <div className="mt-[clamp(12px,3vh,36px)] flex w-full justify-center">
              <Subtitle line={presentation.subtitle} />
            </div>
          </section>
          <section
            aria-label="Transcript"
            ref={(el) => {
              sections.current.transcript = el;
            }}
            inert={!transcriptOpen || sheetCovers}
            className={layerClass(transcriptOpen)}
          >
            <h2 tabIndex={-1} data-layer-heading className="sr-only">
              Transcript
            </h2>
            <Transcript
              rows={presentation.timeline}
              visible={transcriptOpen && !sheetCovers}
              onOpenWorker={() => switchLayer('workers')}
            />
          </section>
          <section
            aria-label="Worker"
            ref={(el) => {
              sections.current.workers = el;
            }}
            inert={!workersOpen || sheetCovers}
            className={layerClass(workersOpen)}
          >
            {/* Mounted only while showing, so the Worker streams run only then. */}
            {workersOpen && (
              <WorkersLayer onClose={() => switchLayer('stage', { viaWorkersClose: true })} />
            )}
          </section>
        </div>

        {!phone && (
          <aside
            aria-label="Show"
            inert={!panelOpen}
            className={`min-w-0 transition-[flex-basis,opacity] duration-(--duration-surface) ease-expo motion-reduce:transition-opacity ${panelOpen ? 'basis-[60%] opacity-100' : 'basis-0 opacity-0'}`}
          >
            {/* No overflow clipping here: the card's soft shadow needs room. Closing slides the card off the right edge. */}
            <div
              className={`h-full min-w-[440px] pt-1 pr-4 pb-1 transition-transform duration-(--duration-surface) ease-expo motion-reduce:transition-none ${panelOpen ? 'translate-x-0' : 'translate-x-8 motion-reduce:translate-x-0'}`}
            >
              {shown && <ShowPanel key={shown.handle} show={shown} onClose={closePanel} />}
            </div>
          </aside>
        )}
      </main>

      {phone && (
        <ShowSheet
          show={shown}
          open={panelOpen}
          speaking={moment === 'speaking'}
          onClose={closePanel}
        />
      )}

      <footer className="relative z-20 col-start-1 row-start-3 px-4 pt-3 pb-5 max-sm:px-3 max-sm:pt-2.5 max-sm:pb-3">
        <div className="mb-3.5 max-sm:mb-2.5">
          <StatusLine
            moment={presentation.status}
            fault={presentation.fault}
            thinkingSince={presentation.thinkingSince}
          />
        </div>
        <Dock
          shape={ask ? 'ask' : 'composer'}
          contentKey={ask ? `ask-${askHandle(ask)}` : 'composer'}
        >
          {ask ? (
            <AskForm
              input={ask.input}
              mode={ask.mode}
              answer={ask.mode === 'sent' ? ask.answer : undefined}
              narrating={moment === 'speaking'}
              disabled={composer === 'offline'}
              onSubmit={(answer) =>
                ask.mode === 'open'
                  ? commands.answerAsk(ask.execution, answer)
                  : Promise.resolve(false)
              }
              onInterrupt={() => void commands.interrupt()}
              extra={
                ask.mode === 'open'
                  ? composer === 'retryClip' && retryClipButton
                  : interruptible && interruptButton
              }
            />
          ) : (
            <Composer
              mode={composer}
              onSend={commands.sendMessage}
              onInterrupt={commands.interrupt}
              onRetry={commands.retryGeneration}
              onRetryClip={playback.retryClip}
            />
          )}
        </Dock>
      </footer>
    </div>
  );
}

/** The question's call handle: the dock keeps one surface while a question goes from open to sent. */
const askHandle = (ask: AskPresence) =>
  ask.mode === 'open' ? ask.execution.handles[0] : ask.handle;
