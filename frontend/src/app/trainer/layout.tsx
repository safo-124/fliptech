import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "Trainer profile",
  robots: {index: false, follow: false},
};

export default function TrainerLayout({children}: {children: React.ReactNode}) {
  return (
    <div className="relative isolate mx-auto min-h-[60dvh] max-w-5xl overflow-hidden px-3 py-5 sm:py-7 lg:px-6 lg:py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-28 -top-32 -z-10 size-72 rounded-full bg-[var(--color-brand-soft)]/70 blur-3xl"
      />
      {children}
    </div>
  );
}
