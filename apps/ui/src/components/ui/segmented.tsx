import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { cn } from "../../lib/utils";

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

/** Single-choice toggle group. Pressing the active segment keeps it selected. */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: V;
  onChange: (value: V) => void;
  options: readonly SegmentOption<V>[];
  label: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked) onChange(picked);
      }}
      className="inline-flex rounded-md border border-line bg-surface p-0.5"
    >
      {options.map((o) => (
        <Toggle
          key={o.value}
          value={o.value}
          className={cn(
            "h-6 rounded px-2.5 text-xs font-medium text-muted transition-colors hover:text-ink",
            "data-[pressed]:bg-sunken data-[pressed]:text-ink",
          )}
        >
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
