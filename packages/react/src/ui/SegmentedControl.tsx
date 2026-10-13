import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';

export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: string;
}

export interface SegmentedControlProps<V extends string> {
  /** Accessible name of the group, such as "Agent". */
  readonly label: string;
  readonly value: V;
  readonly options: readonly SegmentedOption<V>[];
  readonly onChange: (value: V) => void;
  /** Shows the choice but ignores changes, such as while a request is in flight. */
  readonly readOnly?: boolean;
  readonly className?: string;
}

/**
 * Equal pills for a "pick one" choice among a few peers: no option looks like the default. It is a radio group, so
 * Tab enters at the selected pill and the arrow keys move the choice. Keyboard and screen-reader behaviour come from
 * Base UI. Each pill is 40 px tall to sit inside a field's bar; its hit area extends to 44 px.
 */
export function SegmentedControl<V extends string>({
  label,
  value,
  options,
  onChange,
  readOnly = false,
  className = '',
}: SegmentedControlProps<V>) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(next as V)}
      readOnly={readOnly}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full bg-scrim/40 shadow-[inset_0_0_0_1px_rgb(91_96_120/0.45)] p-1 data-readonly:opacity-60 ${className}`}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          className="relative inline-flex cursor-pointer items-center justify-center rounded-full font-medium whitespace-nowrap text-fg-subtle transition-[background-color,color,box-shadow] duration-(--duration-ui) ease-expo outline-none select-none hover:text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue data-checked:bg-elevated data-checked:text-fg data-checked:shadow-[inset_0_0_0_1px_rgb(91_96_120/0.6),0_2px_8px_rgb(0_0_0/0.25)] min-h-10 px-3.5 before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] text-[13.5px] max-sm:px-2.5 data-readonly:cursor-default"
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
