import type { Icon } from "@phosphor-icons/react";
import { useRef, type KeyboardEvent } from "react";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Renders an icon-only segment; `label` becomes its accessible name and tooltip. */
  readonly icon?: Icon;
}

interface SegmentedControlProps<T extends string> {
  readonly label: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** `brand` fills the selected segment with the brand color; `neutral` raises it. */
  readonly tone?: "brand" | "neutral";
}

/** A radio group whose selection slides between equal-width segments. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  tone = "neutral",
}: SegmentedControlProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (selected + step + options.length) % options.length;
    onChange(options[next]!.value);
    buttons.current[next]?.focus();
  };

  const indicator =
    tone === "brand" ? "bg-brand shadow-sm" : "bg-surface-level-1 shadow-sm ring-1 ring-black/5";
  const selectedText = tone === "brand" ? "text-brand-on-fill" : "text-primary";

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="relative grid rounded-md border border-default bg-surface-level-2 p-[2px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className={`absolute inset-y-[2px] left-[2px] rounded-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${indicator}`}
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${selected * 100}%)`,
        }}
      />
      {options.map((option, index) => {
        const checked = index === selected;
        const OptionIcon = option.icon;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={OptionIcon ? option.label : undefined}
            title={OptionIcon ? option.label : undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`relative z-10 flex h-6 items-center justify-center whitespace-nowrap rounded-sm text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${
              OptionIcon ? "px-space-2" : "px-space-3"
            } ${checked ? selectedText : "text-tertiary hover:text-secondary"}`}
          >
            {OptionIcon ? (
              <OptionIcon size={14} weight={checked ? "fill" : "regular"} />
            ) : (
              option.label
            )}
          </button>
        );
      })}
    </div>
  );
}
