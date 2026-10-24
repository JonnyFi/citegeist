import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { cn } from "../../lib/utils";

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  /** Counter in mono after the label (tabs only). */
  count?: number | undefined;
  disabled?: boolean | undefined;
}

/**
 * Single-choice toggle group. Pressing the active segment keeps it selected. "group" is the
 * bordered button group with an inverted active segment; "tabs" is the underlined tab row of a
 * sub bar.
 */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
  variant = "group",
  className,
}: {
  value: V;
  onChange: (value: V) => void;
  options: readonly SegmentOption<V>[];
  label: string;
  variant?: "group" | "tabs";
  className?: string;
}) {
  const tabs = variant === "tabs";
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked) onChange(picked);
      }}
      className={cn(tabs ? "flex items-stretch gap-6 self-stretch" : "inline-flex", className)}
    >
      {options.map((o) => (
        <Toggle
          key={o.value}
          value={o.value}
          disabled={o.disabled ?? false}
          className={
            tabs
              ? cn(
                  "inline-flex items-center border-b-2 border-transparent text-[13px] font-medium text-muted hover:text-ink",
                  "data-[pressed]:border-ink data-[pressed]:text-ink",
                )
              : cn(
                  "h-[26px] border border-line px-2.5 text-[12px] font-medium text-ink [&:not(:first-child)]:border-l-0 disabled:opacity-50",
                  "hover:bg-sunken data-[pressed]:border-ink data-[pressed]:bg-ink data-[pressed]:text-bg",
                )
          }
        >
          {o.label}
          {tabs && o.count !== undefined ? (
            <span className="ml-1.5 font-mono font-normal">{o.count}</span>
          ) : null}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
