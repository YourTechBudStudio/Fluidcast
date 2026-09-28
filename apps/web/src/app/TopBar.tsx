import { useAtom } from '@effect/atom-react';
import { PanelRight, SquareTerminal, TextAlignStart, Undo2 } from 'lucide-react';
import type { Ref } from 'react';

import { Button, Kbd, RadioMenu } from '../ui';
import { VISUAL_IDS, VISUAL_NAMES, VisualSwatch } from '../visuals';
import type { Layer } from './layers';
import { visualAtom } from './state';

const VISUAL_OPTIONS = VISUAL_IDS.map((id) => ({
  value: id,
  label: VISUAL_NAMES[id],
  icon: <VisualSwatch id={id} />,
}));

const icon = { size: 16, strokeWidth: 1.8, 'aria-hidden': true } as const;

export interface TopBarProps {
  /** Back presents the previous line again; unavailable when there is none. */
  readonly back: { readonly available: boolean; readonly onBack: () => void };
  /** The Show panel: pressed while open; unavailable until there has been a Show. */
  readonly show: {
    readonly open: boolean;
    readonly available: boolean;
    readonly onToggle: () => void;
  };
  /** The transcript and Workers buttons: pressed while their layer shows; each toggles it with the stage. */
  readonly layers: {
    readonly current: Layer;
    readonly onToggle: (layer: 'transcript' | 'workers') => void;
    /** The Workers button, where focus returns when the layer closes from its own close button. */
    readonly workersRef: Ref<HTMLButtonElement>;
  };
}

export function TopBar({ back, show, layers }: TopBarProps) {
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
          aria-keyshortcuts="B"
          unavailable={!back.available}
          className="text-sm"
          icon={<Undo2 {...icon} />}
          onClick={back.onBack}
        >
          <span className="max-sm:hidden">Back</span>
          <span className="max-sm:hidden">
            <Kbd>B</Kbd>
          </span>
        </Button>
        <RadioMenu
          label="Visual"
          value={visual}
          options={VISUAL_OPTIONS}
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
          aria-pressed={show.open}
          aria-keyshortcuts="S"
          unavailable={!show.available}
          className="text-sm"
          icon={<PanelRight {...icon} />}
          onClick={show.onToggle}
        >
          <span className="max-sm:hidden">Show</span>
          <span className="max-sm:hidden">
            <Kbd>S</Kbd>
          </span>
        </Button>
        <Button
          tone="ghost"
          aria-label="Transcript"
          aria-pressed={layers.current === 'transcript'}
          aria-keyshortcuts="E"
          className="text-sm"
          icon={<TextAlignStart {...icon} />}
          onClick={() => layers.onToggle('transcript')}
        >
          <span className="max-sm:hidden">Transcript</span>
          <span className="max-sm:hidden">
            <Kbd>E</Kbd>
          </span>
        </Button>
        <Button
          ref={layers.workersRef}
          tone="ghost"
          aria-label="Workers"
          aria-pressed={layers.current === 'workers'}
          aria-keyshortcuts="W"
          className="text-sm"
          icon={<SquareTerminal {...icon} />}
          onClick={() => layers.onToggle('workers')}
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
