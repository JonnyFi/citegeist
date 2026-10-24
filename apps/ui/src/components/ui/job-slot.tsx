import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * Slot in the top bar for background work: label in capitals, a 4px bar and a counter. The counter
 * opens the list of jobs. With nothing to show, `label` carries the idle text and the bar stays
 * empty.
 */
export function JobSlot({
  label,
  progress,
  counter,
  agent = false,
  list,
  listLabel,
}: {
  label: string;
  /** 0 to 1; undefined draws an empty track. */
  progress?: number | undefined;
  counter?: string | undefined;
  /** Research progress is drawn in the agent colour, everything else in ink. */
  agent?: boolean;
  list?: ReactNode;
  listLabel: string;
}) {
  return (
    <div className="flex h-full w-aside shrink-0 items-center gap-3 border-l border-line px-4">
      <div className="min-w-0 truncate text-label font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress === undefined ? undefined : Math.round(progress * 100)}
        className="flex h-1 min-w-8 flex-1 bg-line-soft"
      >
        {progress !== undefined ? (
          <div
            className={cn("h-full", agent ? "bg-agent" : "bg-ink")}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        ) : null}
      </div>
      {counter ? (
        list ? (
          <Popover.Root>
            <Popover.Trigger className="whitespace-nowrap text-[12px] text-muted hover:text-ink">
              {counter}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner side="bottom" align="end" sideOffset={0} className="z-50">
                <Popover.Popup
                  aria-label={listLabel}
                  className="w-aside border border-line bg-surface text-ink"
                >
                  {list}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <span className="whitespace-nowrap text-[12px] text-muted">{counter}</span>
        )
      ) : null}
    </div>
  );
}
