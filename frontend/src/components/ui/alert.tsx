import {cva, type VariantProps} from "class-variance-authority";
import * as React from "react";

import {cn} from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] gap-y-1 rounded-xl border px-4 py-3.5 text-sm has-[>svg]:grid-cols-[1.1rem_1fr] has-[>svg]:gap-x-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default:
          "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-card-foreground)]",
        destructive:
          "border-[var(--color-destructive)]/35 bg-[var(--color-destructive)]/5 text-[var(--color-destructive)]",
        success:
          "border-[var(--color-visit)]/35 bg-[var(--color-visit-bg)] text-[var(--color-visit)]",
        warning:
          "border-[var(--color-warn)]/35 bg-[var(--color-warn-bg)] text-[var(--color-warn)]",
      },
    },
    defaultVariants: {variant: "default"},
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({variant}), className)}
      {...props}
    />
  );
}

function AlertTitle({className, ...props}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 font-semibold leading-5", className)}
      {...props}
    />
  );
}

function AlertDescription({className, ...props}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 text-current/80 [&_p]:leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export {Alert, AlertDescription, AlertTitle, alertVariants};
