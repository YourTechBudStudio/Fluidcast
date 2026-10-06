import { Menu } from '@base-ui/react/menu';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

export interface RadioMenuOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly icon?: ReactNode;
}

export interface RadioMenuProps<V extends string> {
  /** Accessible name of the menu and its trigger, such as "Visual". */
  readonly label: string;
  readonly value: V;
  readonly options: readonly RadioMenuOption<V>[];
  readonly onChange: (value: V) => void;
  /** Trigger content; the trigger itself is a 44 px ghost button. */
  readonly trigger: ReactNode;
  /** Extra trigger classes, such as tighter padding on phones. */
  readonly className?: string;
}

/** A compact "pick one" menu: a quiet trigger and a glass popup of radio items. Keyboard and screen-reader behaviour come from Base UI. */
export function RadioMenu<V extends string>({
  label,
  value,
  options,
  onChange,
  trigger,
  className = '',
}: RadioMenuProps<V>) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm text-fg-muted transition-colors duration-(--duration-ui) ease-expo hover:bg-elevated/45 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue data-popup-open:bg-elevated/70 data-popup-open:text-fg ${className}`}
      >
        {trigger}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="w-61 origin-(--transform-origin) rounded-md border border-line/40 bg-subtle/92 p-1.5 shadow-soft backdrop-blur-xl transition-[opacity,transform] duration-(--duration-ui) ease-expo outline-none data-ending-style:-translate-y-1 data-ending-style:opacity-0 data-starting-style:-translate-y-1 data-starting-style:opacity-0">
            <Menu.Group>
              <Menu.GroupLabel className="px-2.5 pt-2 pb-1.5 font-mono text-[11px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
                {label}
              </Menu.GroupLabel>
              <Menu.RadioGroup value={value} onValueChange={(next: V) => onChange(next)}>
                {options.map((option) => (
                  <Menu.RadioItem
                    key={option.value}
                    value={option.value}
                    label={option.label}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2.5 text-sm text-fg-muted outline-none select-none data-checked:text-fg data-highlighted:bg-overlay/70 data-highlighted:text-fg"
                  >
                    {option.icon}
                    {option.label}
                    <Menu.RadioItemIndicator className="ml-auto text-blue">
                      <Check size={16} strokeWidth={1.8} aria-hidden />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
