import { useAtom, useAtomValue } from '@effect/atom-react';
import { useEffect, useMemo } from 'react';

import {
  Composer,
  presentationAtom,
  StatusLine,
  Transcript,
  useConversationCommands,
} from '../conversation';
import { Subtitle, TapToResume, usePlaybackAnalyser, usePlaybackControls } from '../playback';
import { useReducedMotion } from '../ui';
import { analyserSource, createAnalysis, Visual } from '../visuals';
import { transcriptOpenAtom, visualAtom } from './state';
import { TopBar } from './TopBar';

/** One analysis handle for the page. The player's analyser feeds it; visuals read it per frame. */
const analysis = createAnalysis();

const typingTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('textarea, input, select, [contenteditable="true"], [role="menu"]') !== null;

export function App() {
  const presentation = useAtomValue(presentationAtom);
  const commands = useConversationCommands();
  const playback = usePlaybackControls();
  const analyser = usePlaybackAnalyser();
  const visual = useAtomValue(visualAtom);
  const [transcriptOpen, setTranscriptOpen] = useAtom(transcriptOpenAtom);
  const reducedMotion = useReducedMotion();
  const { moment, composer } = presentation;

  useEffect(() => {
    analysis.connect(analyserSource(analyser));
    return () => analysis.connect(null);
  }, [analyser]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (
        event.key === 'Escape' &&
        (composer === 'busy' || composer === 'retryClip') &&
        !(event.target instanceof Element && event.target.closest('[role="menu"]'))
      ) {
        event.preventDefault();
        commands.interrupt();
      } else if ((event.key === 'e' || event.key === 'E') && !typingTarget(event.target)) {
        event.preventDefault();
        setTranscriptOpen(!transcriptOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commands, composer, transcriptOpen, setTranscriptOpen]);

  const inputs = useMemo(
    () => ({ state: presentation.visual, analysis, reducedMotion, held: presentation.held }),
    [presentation.visual, presentation.held, reducedMotion],
  );

  const layer =
    'absolute inset-0 transition-[opacity,visibility] duration-(--duration-surface) ease-expo';
  return (
    <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
      <TopBar />
      <main className="relative min-h-0">
        <section
          aria-label="Now playing"
          inert={transcriptOpen}
          className={`${layer} flex flex-col items-center justify-center px-4 pb-4 ${transcriptOpen ? 'invisible opacity-0' : 'visible opacity-100'}`}
        >
          <div className="relative h-[clamp(250px,46vh,460px)] w-full shrink-0">
            <Visual id={visual} inputs={inputs} active={!transcriptOpen} />
            <TapToResume visible={moment === 'held'} onResume={playback.resume} />
          </div>
          <div className="mt-[clamp(16px,4vh,44px)] flex w-full justify-center">
            <Subtitle line={presentation.subtitle} />
          </div>
        </section>
        <section
          aria-label="Transcript"
          inert={!transcriptOpen}
          className={`${layer} ${transcriptOpen ? 'visible opacity-100' : 'invisible opacity-0'}`}
        >
          <Transcript rows={presentation.timeline} visible={transcriptOpen} />
        </section>
      </main>
      <footer className="relative z-20 px-4 pb-5">
        <div className="mb-3.5">
          <StatusLine moment={presentation.status} />
        </div>
        <Composer
          mode={composer}
          onSend={commands.sendMessage}
          onInterrupt={commands.interrupt}
          onRetry={commands.retryGeneration}
          onRetryClip={playback.retryClip}
        />
      </footer>
    </div>
  );
}
