import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "Your account",
  robots: {index: false, follow: false},
};

export default function TraineeLayout({children}: {children: React.ReactNode}) {
  return <div className="mx-auto min-h-[60dvh] max-w-5xl px-3 py-5 sm:py-7 lg:px-6 lg:py-10">{children}</div>;
}
