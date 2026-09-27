import { X } from 'lucide-react';

import type { ShowInput } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { Button, Chip } from '../../ui';
import { FORMAT_LABEL, FORMAT_TILE, FORMAT_TONE, titleOf } from './format';
import { FormatIcon } from './FormatIcon';

/**
 * A Show's title bar: format tile, title, format chip and ✕. `speaking` adds a breathing dot for narration, which only
 * the phone sheet passes, because the sheet hides the orb.
 */
export function ShowHeader({
  input,
  onClose,
  speaking = false,
  className = '',
}: {
  readonly input: ShowInput;
  readonly onClose: () => void;
  readonly speaking?: boolean;
  readonly className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 py-2 pr-2 pl-3 ${className}`}>
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-sm ${FORMAT_TILE[input.format]}`}
      >
        <FormatIcon format={input.format} />
      </span>
      <h2 className="min-w-0 truncate font-display text-[16px] font-medium tracking-[-0.01em] text-fg">
        {titleOf(input)}
      </h2>
      <span className="shrink-0">
        <Chip tone={FORMAT_TONE[input.format]}>{FORMAT_LABEL[input.format]}</Chip>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {speaking && (
          <i
            aria-hidden
            className="size-1.5 rounded-full bg-blue shadow-[0_0_10px_var(--color-blue)] motion-safe:animate-breathe"
          />
        )}
        <Button
          tone="ghost"
          aria-label="Close show"
          icon={<X size={17} strokeWidth={1.8} aria-hidden />}
          onClick={onClose}
        />
      </span>
    </div>
  );
}
