import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/**
 * Square, 1px ink border. Primary is the inverted block (ink on bg), the one active look of the
 * system. Heights follow the boards: 26px in sub bars (sm), 28px in content (md).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border text-[12px] font-medium leading-none transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "border-ink bg-ink text-bg hover:opacity-85",
        outline: "border-line bg-transparent text-ink hover:bg-sunken",
        ghost: "border-transparent bg-transparent text-ink hover:bg-sunken",
      },
      size: {
        sm: "h-[26px] px-2.5",
        md: "h-7 px-3",
        icon: "size-7",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type ButtonProps = ComponentProps<typeof BaseButton> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <BaseButton className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** Buttons that share one border line: every button after the first drops its left border. */
export function ButtonGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex [&>*+*]:border-l-0", className)} {...props} />;
}
