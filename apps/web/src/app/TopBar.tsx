import { useAtom } from '@effect/atom-react';
import { PanelRight, RotateCcw, SquareTerminal, TextAlignStart } from 'lucide-react';
import type { Ref } from 'react';

import { Button, Kbd, RadioMenu } from '../ui';
import { VISUAL_IDS, VISUAL_NAMES, VisualSwatch } from '../visuals';
import { Brand } from './Brand';
import { Spinner } from './feedback';
import type { Layer } from './layers';
import { visualAtom } from './state';

const VISUAL_OPTIONS = VISUAL_IDS.map((id) => ({
  value: id,
  label: VISUAL_NAMES[id],
  icon: <VisualSwatch id={id} />,
}));

const icon = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const;

/**
 * Below `lg` the buttons show their icon only, because the labelled row (about 900 px with "Resetting…") would push
 * Reset off screen. Their 44 px minimum width is then the hit area, with no extra padding, so every control fits even a
 * 320 px phone.
 */
const ICON_ONLY = 'text-sm max-lg:px-0';

export interface TopBarProps {
  /** The Show panel: pressed while open; unavailable until there has been a Show. */
  readonly show: {
    readonly open: boolean;
    readonly available: boolean;
    readonly onToggle: () => void;
  };
  /** The transcript and Worker buttons: pressed while their layer shows; each toggles it with the stage. */
  readonly layers: {
    readonly current: Layer;
    readonly onToggle: (layer: 'transcript' | 'workers') => void;
    /** The Worker button, where focus returns when the layer closes from its own close button. */
    readonly workersRef: Ref<HTMLButtonElement>;
  };
  /**
   * Reset ends this session and returns to the mode screen, with no confirmation. While `pending` it shows its progress
   * and ignores presses; when the last one `failed`, its text is red and pressing it again retries.
   */
  readonly reset: {
    readonly onReset: () => void;
    readonly pending: boolean;
    readonly failed: boolean;
  };
}

export function TopBar({ show, layers, reset }: TopBarProps) {
  const [visual, setVisual] = useAtom(visualAtom);
  return (
    <header className="relative z-20 flex min-h-17 items-center gap-3 px-4.5 py-3.5 max-sm:gap-1 max-sm:px-3">
      <Brand compact />
      <div className="ml-auto flex items-center gap-1.5 max-sm:gap-0.5">
        <RadioMenu
          label="Visual"
          className="max-lg:px-1.5"
          value={visual}
          options={VISUAL_OPTIONS}
          onChange={setVisual}
          trigger={
            <>
              <VisualSwatch id={visual} />
              <span className="max-lg:hidden">{VISUAL_NAMES[visual]}</span>
            </>
          }
        />
        <Button
          tone="ghost"
          aria-label="Show"
          aria-pressed={show.open}
          aria-keyshortcuts="S"
          unavailable={!show.available}
          className={ICON_ONLY}
          icon={<PanelRight {...icon} />}
          onClick={show.onToggle}
        >
          <span className="max-lg:hidden">Show</span>
          <span className="max-lg:hidden">
            <Kbd>S</Kbd>
          </span>
        </Button>
        <Button
          tone="ghost"
          aria-label="Transcript"
          aria-pressed={layers.current === 'transcript'}
          aria-keyshortcuts="E"
          className={ICON_ONLY}
          icon={<TextAlignStart {...icon} />}
          onClick={() => layers.onToggle('transcript')}
        >
          <span className="max-lg:hidden">Transcript</span>
          <span className="max-lg:hidden">
            <Kbd>E</Kbd>
          </span>
        </Button>
        <Button
          ref={layers.workersRef}
          tone="ghost"
          aria-label="Worker"
          aria-pressed={layers.current === 'workers'}
          aria-keyshortcuts="W"
          className={ICON_ONLY}
          icon={<SquareTerminal {...icon} />}
          onClick={() => layers.onToggle('workers')}
        >
          <span className="max-lg:hidden">Worker</span>
          <span className="max-lg:hidden">
            <Kbd>W</Kbd>
          </span>
        </Button>
        <span aria-hidden className="mx-1 h-5 w-px bg-line/45 max-sm:mx-0" />
        <Button
          tone="ghost"
          aria-label="Reset: end this session and go back to the start"
          unavailable={reset.pending}
          className={`${ICON_ONLY} ${reset.failed ? 'text-red hover:text-red' : ''}`}
          icon={reset.pending ? <Spinner size={15} /> : <RotateCcw {...icon} />}
          onClick={reset.onReset}
        >
          <span className="max-lg:hidden">{reset.pending ? 'Resetting…' : 'Reset'}</span>
        </Button>
      </div>
    </header>
  );
}
