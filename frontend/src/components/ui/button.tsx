import {Slot} from "@radix-ui/react-slot";
import {cva, type VariantProps} from "class-variance-authority";
import * as React from "react";

import {cn} from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)] disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm hover:bg-[var(--color-primary)]/90 hover:shadow-md",
        brand:
          "bg-[var(--color-brand)] text-white shadow-sm shadow-[var(--color-brand)]/20 hover:bg-[var(--color-brand-strong)] hover:shadow-md",
        // The logo's warm shards, for the one primary action sitting on the
        // indigo band. Another violet button there would disappear into it,
        // and this is the contrast the logo itself already uses.
        warm: "bg-gradient-to-br from-[var(--color-sand)] via-[var(--color-peach)] to-[var(--color-coral)] text-[var(--color-brand-deep)] shadow-sm hover:brightness-105 hover:shadow-md",
        // Secondary actions on the indigo band. Hairline white rather than a
        // filled surface, so it recedes behind `warm`.
        onBand:
          "border border-white/25 bg-white/10 text-white backdrop-blur-sm hover:border-white/40 hover:bg-white/20",
        destructive:
          "bg-[var(--color-destructive)] text-white shadow-sm hover:bg-[var(--color-destructive)]/90",
        outline:
          "border border-[var(--color-border-strong)] bg-[var(--color-card)] text-[var(--color-foreground)] shadow-xs hover:border-[var(--color-foreground)]/20 hover:bg-[var(--color-muted)]",
        secondary:
          "bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] hover:bg-[var(--color-secondary)]/75",
        ghost: "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
        link: "min-h-0 text-[var(--color-primary)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-11 rounded-lg px-3 text-xs",
        lg: "h-12 rounded-xl px-6 text-base",
        icon: "size-11 p-0",
        "icon-sm": "size-11 p-0",
      },
    },
    defaultVariants: {variant: "default", size: "default"},
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({variant, size, className}))}
      {...props}
    />
  );
}

export {Button, buttonVariants};
