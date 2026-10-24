import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** "box" is the content field with a 1px border; "line" is the bar field with only an underline. */
export function Input({
  className,
  variant = "box",
  ...props
}: ComponentProps<typeof BaseInput> & { variant?: "box" | "line" }) {
  return (
    <BaseInput
      className={cn(
        "w-full bg-transparent text-[13px] text-ink placeholder:text-muted",
        variant === "box"
          ? "h-7 border border-line px-2.5"
          : "h-[30px] border-0 border-b border-line px-0",
        className,
      )}
      {...props}
    />
  );
}

/** Multi-line field, same two looks as Input. */
export function Textarea({
  className,
  variant = "box",
  ...props
}: ComponentProps<"textarea"> & { variant?: "box" | "line" }) {
  return (
    <textarea
      className={cn(
        "w-full bg-transparent text-[13px] text-ink placeholder:text-muted",
        variant === "box"
          ? "border border-line p-2"
          : "border-0 border-b border-line-faint px-0 py-1",
        className,
      )}
      {...props}
    />
  );
}
