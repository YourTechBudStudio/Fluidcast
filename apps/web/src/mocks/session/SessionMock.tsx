import { useEffect, useState } from 'react';

import { Composer } from '../../conversation';
import { Subtitle, type SubtitleLine } from '../../playback';
import { MockPanel } from '../MockPanel';
import { StageVisual } from '../mode/shared';
import {
  CONTINUE_MESSAGE,
  SAMPLE,
  SESSION_SUMMARY,
  SESSION_STATES,
  type SessionState,
  useSessionMock,
} from './model';
import { MockStatus, MockTopBar, MockTranscript, TapToStart } from './parts';

const NOTES = [
  'A Continue session. New brainstorm opens today’s empty player, so it isn’t mocked.',
  'Tap to start runs the flow: thinking, then the first line. Reset goes back to the mode screen mock.',
  'Reset has no confirmation, as designed. The Claude session stays on disk.',
];

const NO_OP = () => {};

export function SessionMock() {
  const mock = useSessionMock();
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const elapsed = useElapsed(mock.state === 'starting');

  const { state } = mock;
  const waiting = state === 'ready' || state === 'resetting' || state === 'resetFailed';

  return (
    <>
      <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
        <MockTopBar
          state={state}
          transcriptOpen={transcriptOpen}
          onTranscript={() => setTranscriptOpen((v) => !v)}
          onReset={mock.onReset}
        />

        <main className="relative flex min-h-0">
          <div className="relative min-w-0 flex-1">
            <section
              aria-label="Now playing"
              inert={transcriptOpen}
              className={`absolute inset-0 flex flex-col items-center justify-center px-6 pb-2 transition-opacity duration-(--duration-surface) ease-expo max-sm:px-4 ${transcriptOpen ? 'invisible opacity-0' : 'opacity-100'}`}
            >
              <div
                className={`relative w-full shrink-0 transition-[height] duration-(--duration-room) ease-expo motion-reduce:transition-none h-[clamp(250px,46vh,460px)] max-sm:h-[clamp(170px,30vh,300px)]`}
              >
                <StageVisual
                  state={
                    state === 'starting' ? 'thinking' : state === 'speaking' ? 'speaking' : 'idle'
                  }
                  voice={state === 'speaking'}
                  className="h-full"
                />
                <TapToStart
                  visible={waiting}
                  unavailable={state === 'resetting'}
                  onStart={mock.start}
                />
              </div>
              <div className="mt-[clamp(12px,3vh,36px)] flex w-full justify-center">
                <Subtitle line={subtitleFor(state)} />
              </div>
            </section>
            <section
              aria-label="Transcript"
              inert={!transcriptOpen}
              className={`absolute inset-0 transition-opacity duration-(--duration-surface) ease-expo ${transcriptOpen ? 'opacity-100' : 'invisible opacity-0'}`}
            >
              <MockTranscript state={state} />
            </section>
          </div>
        </main>

        <footer className="relative z-20 px-4 pt-3 pb-5 max-sm:px-3 max-sm:pt-2.5 max-sm:pb-3">
          <div className="mb-3.5 max-sm:mb-2.5">
            <MockStatus state={state} elapsed={elapsed} />
          </div>
          <div className="mx-auto w-full max-w-[680px] overflow-hidden rounded-[20px] border border-[rgb(91_96_120/0.42)] bg-[rgb(54_58_79/0.42)] shadow-soft backdrop-blur-xl backdrop-saturate-130">
            <Composer
              mode={state === 'starting' || state === 'speaking' ? 'busy' : 'offline'}
              onSend={() => Promise.resolve(false)}
              onInterrupt={NO_OP}
              onRetry={NO_OP}
              onRetryClip={NO_OP}
            />
          </div>
        </footer>
      </div>

      <MockPanel
        title="Session"
        summary={SESSION_SUMMARY}
        controls={[
          {
            label: 'State',
            value: state,
            options: SESSION_STATES,
            onChange: (s) => mock.setState(s as SessionState),
          },
        ]}
        notes={NOTES}
      />
    </>
  );
}

/** The subtitle slot: the preloaded message while waiting, your message right after the tap, then the first line. */
function subtitleFor(state: SessionState): SubtitleLine {
  if (state === 'starting')
    return { key: 'you', text: CONTINUE_MESSAGE, tone: 'you', label: 'You' };
  if (state === 'speaking') return { key: 'line', text: SAMPLE.firstLine, tone: 'current' };
  return {
    key: 'preloaded',
    text: `“${CONTINUE_MESSAGE}”`,
    tone: 'you',
    label: 'Preloaded · Tap to start says',
  };
}

/** Whole seconds since `on` became true. */
function useElapsed(on: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!on) return;
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return seconds;
}
