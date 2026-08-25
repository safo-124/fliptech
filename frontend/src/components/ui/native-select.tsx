import {ChevronDown} from "lucide-react";
import * as React from "react";

import {cn} from "@/lib/utils";

function NativeSelect({className, children, ...props}: React.ComponentProps<"select">) {
  return (
    <div data-slot="native-select-wrapper" className="relative w-full">
      <select
        data-slot="native-select"
        className={cn(
          "h-12 w-full appearance-none rounded-xl border border-[var(--color-input)] bg-[var(--color-card)] px-3.5 py-2 pr-10 text-base shadow-xs outline-none transition-[border-color,box-shadow,background-color] hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-ring)] focus-visible:ring-3 focus-visible:ring-[var(--color-ring)]/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--color-muted)] disabled:opacity-60 sm:text-sm",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
      />
    </div>
  );
}

export {NativeSelect};
