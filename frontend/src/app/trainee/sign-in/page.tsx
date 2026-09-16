import type {Metadata} from "next";
import {GraduationCap} from "lucide-react";
import {Suspense} from "react";

import {TraineeSignIn} from "@/components/trainee/TraineeSignIn";
import {Badge} from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Sign up or sign in",
  description: "Keep your training enquiries and saved workshops in one place.",
};

export default function TraineeSignInPage() {
  return (
    <div className="mx-auto max-w-md">
      <header className="mb-5">
        <Badge variant="secondary">
          <GraduationCap aria-hidden="true" />
          For trainees
        </Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.035em]">Your Skills Hub account</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
          See every enquiry you sent, the training you started, and the workshops you saved.
        </p>
      </header>
      <Suspense>
        <TraineeSignIn />
      </Suspense>
    </div>
  );
}
