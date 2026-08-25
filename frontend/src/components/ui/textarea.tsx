import * as React from "react";

import {cn} from "@/lib/utils";

function Textarea({className, ...props}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-28 w-full resize-y rounded-xl border border-[var(--color-input)] bg-[var(--color-card)] px-3.5 py-3 text-base shadow-xs outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[var(--color-muted-foreground)]/70 hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-ring)] focus-visible:ring-3 focus-visible:ring-[var(--color-ring)]/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--color-muted)] disabled:opacity-60 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export {Textarea};
