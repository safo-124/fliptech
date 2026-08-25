import {Slot} from "@radix-ui/react-slot";
import {cva, type VariantProps} from "class-variance-authority";
import * as React from "react";

import {cn} from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
        secondary:
          "border-transparent bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]",
        outline: "border-[var(--color-border-strong)] bg-[var(--color-card)] text-[var(--color-foreground)]",
        visit: "border-[var(--color-visit)]/25 bg-[var(--color-visit-bg)] text-[var(--color-visit)]",
        government: "border-[var(--color-gov)]/25 bg-[var(--color-gov-bg)] text-[var(--color-gov)]",
        warning: "border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] text-[var(--color-warn)]",
      },
    },
    defaultVariants: {variant: "default"},
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & {asChild?: boolean}) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({variant}), className)} {...props} />;
}

export {Badge, badgeVariants};
