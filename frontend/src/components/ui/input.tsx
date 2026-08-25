import * as React from "react";

import {cn} from "@/lib/utils";

function Input({className, type, ...props}: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-12 w-full min-w-0 rounded-xl border border-[var(--color-input)] bg-[var(--color-card)] px-3.5 py-2 text-base shadow-xs outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[var(--color-muted-foreground)]/70 hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-ring)] focus-visible:ring-3 focus-visible:ring-[var(--color-ring)]/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--color-muted)] disabled:opacity-60 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export {Input};
