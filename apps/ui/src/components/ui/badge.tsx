import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/**
 * Chip: 1px border, 3px 8px padding. "outline" is a first-order chip (ink border), "neutral" a
 * tag of second order (line-faint border), "accent" the inverted active chip.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 border px-2 py-[3px] text-[12px] leading-[1.2]",
  {
    variants: {
      tone: {
        neutral: "border-line-faint text-ink",
        outline: "border-line text-ink",
        accent: "border-ink bg-ink text-bg",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Outlined uppercase stamp for card states: "ungeprüft" in danger, "nicht gefunden" in ink. */
export function Stamp({
  tone = "ink",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "ink" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap border px-1 text-[10px] font-semibold uppercase leading-[14px] tracking-[0.08em]",
        tone === "danger" ? "border-danger text-danger" : "border-ink text-ink",
        className,
      )}
      {...props}
    />
  );
}

/** Small square before a status word: filled for an active state, outlined for an open one. */
export function StatusSquare({
  filled = true,
  className,
}: {
  filled?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 border border-ink",
        filled ? "bg-ink" : "bg-transparent",
        className,
      )}
    />
  );
}
