import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Select on Base UI, styled as an outlined button. Values are strings; the caller maps "all" to
 * "no filter". `active` inverts the trigger, the way a chosen filter shows in a bar.
 */
export function Select({
  value,
  onChange,
  options,
  label,
  className,
  active = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  label: string;
  className?: string;
  active?: boolean;
}) {
  const items = Object.fromEntries(options.map((o) => [o.value, o.label]));
  return (
    <BaseSelect.Root
      value={value}
      items={items}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={cn(
          "inline-flex h-[26px] min-w-36 items-center justify-between gap-2 border px-2.5 text-[12px]",
          active
            ? "border-ink bg-ink text-bg hover:opacity-85"
            : "border-line bg-transparent text-ink hover:bg-sunken",
          className,
        )}
      >
        <BaseSelect.Value />
        <BaseSelect.Icon>
          <ChevronDown className={cn("size-3.5", active ? "text-bg" : "text-muted")} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50">
          <BaseSelect.Popup className="min-w-36 border border-line bg-surface text-ink">
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item
                  key={o.value}
                  value={o.value}
                  className="flex h-8 cursor-default items-center justify-between gap-3 px-2.5 text-[12px] data-[highlighted]:bg-ink data-[highlighted]:text-bg"
                >
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator>
                    <Check className="size-3.5" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
