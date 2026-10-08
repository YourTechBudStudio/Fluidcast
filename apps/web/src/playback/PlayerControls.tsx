import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';

import { Button } from '../ui';

/** One transport control: unavailable controls stay visible and focusable, and ignore presses. */
export interface TransportControl {
  readonly available: boolean;
  readonly onPress: () => void;
}

export interface PlayerControlsProps {
  readonly back: TransportControl;
  readonly forward: TransportControl;
  /** `paused` shows Play, otherwise Pause. The button keeps one place so pressing it twice never moves the target. */
  readonly play: TransportControl & { readonly paused: boolean };
  readonly className?: string;
}

const icon = { size: 17, strokeWidth: 1.8, 'aria-hidden': true } as const;
const filled = { size: 15, strokeWidth: 0, fill: 'currentColor', 'aria-hidden': true } as const;

/**
 * Back, Play/Pause and Forward: three quiet icon buttons, Play/Pause marked with a faint round well. Presentation only;
 * the caller decides what each press means and when it is available.
 */
export function PlayerControls({ back, forward, play, className = '' }: PlayerControlsProps) {
  return (
    <div role="group" aria-label="Player" className={`flex items-center gap-0.5 ${className}`}>
      <Button
        tone="ghost"
        aria-label="Back"
        aria-keyshortcuts="B"
        unavailable={!back.available}
        className="rounded-full px-0"
        icon={<SkipBack {...icon} />}
        onClick={back.onPress}
      />
      <Button
        tone="ghost"
        aria-label={play.paused ? 'Play' : 'Pause'}
        unavailable={!play.available}
        className="rounded-full bg-elevated/55 px-0 text-fg shadow-[inset_0_0_0_1px_rgb(91_96_120/0.5)]"
        icon={play.paused ? <Play {...filled} className="translate-x-px" /> : <Pause {...filled} />}
        onClick={play.onPress}
      />
      <Button
        tone="ghost"
        aria-label="Forward"
        unavailable={!forward.available}
        className="rounded-full px-0"
        icon={<SkipForward {...icon} />}
        onClick={forward.onPress}
      />
    </div>
  );
}
