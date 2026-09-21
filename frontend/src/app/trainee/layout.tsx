import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "Your account",
  robots: {index: false, follow: false},
};

export default function TraineeLayout({children}: {children: React.ReactNode}) {
  // Wider than the public pages: the account is a two-column workspace from
  // lg up, and a 5xl cap left the content as a ribbon down a wide screen.
  return (
    <div className="mx-auto min-h-[60dvh] max-w-[84rem] px-3 py-5 sm:py-7 lg:px-6 lg:py-10">{children}</div>
  );
}
