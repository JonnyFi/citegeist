import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: ComponentProps<typeof BaseInput>) {
  return (
    <BaseInput
      className={cn(
        "h-8 w-full rounded-md border border-line bg-surface px-2.5 text-sm placeholder:text-muted",
        className,
      )}
      {...props}
    />
  );
}
