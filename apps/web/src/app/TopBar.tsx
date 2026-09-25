import { useAtom } from '@effect/atom-react';
import { TextAlignStart } from 'lucide-react';

import { Button, Kbd, RadioMenu } from '../ui';
import { VISUAL_IDS, VISUAL_NAMES, VisualSwatch } from '../visuals';
import { transcriptOpenAtom, visualAtom } from './state';

const VISUAL_OPTIONS = VISUAL_IDS.map((id) => ({
  value: id,
  label: VISUAL_NAMES[id],
  icon: <VisualSwatch id={id} />,
}));

export function TopBar() {
  const [visual, setVisual] = useAtom(visualAtom);
  const [transcriptOpen, setTranscriptOpen] = useAtom(transcriptOpenAtom);
  return (
    <header className="relative z-20 flex min-h-17 items-center gap-3 px-4.5 py-3.5 max-sm:px-3">
      <div className="inline-flex items-center gap-2.5 font-display text-[15px] font-medium tracking-[-0.01em] text-fg-muted">
        <i
          aria-hidden
          className="size-2 rounded-full bg-linear-135 from-cyan to-violet shadow-[0_0_12px_rgb(145_215_227/0.5)]"
        />
        Fluidcast
      </div>
      <div className="ml-auto flex items-center gap-1.5">
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
          aria-label="Transcript"
          aria-pressed={transcriptOpen}
          aria-keyshortcuts="E"
          className="text-sm"
          icon={<TextAlignStart size={16} strokeWidth={1.8} aria-hidden />}
          onClick={() => setTranscriptOpen(!transcriptOpen)}
        >
          <span className="max-sm:hidden">Transcript</span>
          <span className="max-sm:hidden">
            <Kbd>E</Kbd>
          </span>
        </Button>
      </div>
    </header>
  );
}
