import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  /** Destructive entries show in the danger color. */
  danger?: boolean;
}

/** Menu on Base UI: a trigger that opens a short list of actions. */
export function Menu({
  label,
  trigger,
  entries,
  className,
  align = "start",
}: {
  /** Accessible name of the trigger. */
  label: string;
  trigger: ReactNode;
  entries: readonly MenuEntry[];
  className?: string;
  align?: "start" | "end";
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger type="button" aria-label={label} className={className}>
        {trigger}
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={4} align={align} className="z-50">
          <BaseMenu.Popup className="min-w-44 border border-line bg-surface text-ink">
            {entries.map((entry) => (
              <BaseMenu.Item
                key={entry.label}
                onClick={entry.onSelect}
                className={cn(
                  "flex h-8 cursor-default items-center px-2.5 text-[12px] data-[highlighted]:bg-ink data-[highlighted]:text-bg",
                  entry.danger && "text-danger",
                )}
              >
                {entry.label}
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
