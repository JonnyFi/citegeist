import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Four-point star, 10px. The only sign that an agent or model wrote something. */
export function Star({ className }: { className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={cn("shrink-0 fill-current", className)}
    >
      <path d="M5 0l1.4 3.6L10 5 6.4 6.4 5 10 3.6 6.4 0 5l3.6-1.4z" />
    </svg>
  );
}

/**
 * Origin mark: star plus text in muted. Agents get no colour of their own. The name goes in `who`
 * and is set in mono; `children` holds the sentence around it.
 */
export function Provenance({
  who,
  tail,
  children,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  who?: string | undefined;
  /** Text after the name, such as ": fits research question 2". */
  tail?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 text-[12px] text-muted", className)}
      {...props}
    >
      <Star />
      <span>
        {children}
        {who ? (
          <>
            {" "}
            <span className="font-mono">{who}</span>
          </>
        ) : null}
        {tail}
      </span>
    </span>
  );
}
