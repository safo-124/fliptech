import type {Metadata} from "next";

import {TraineeDashboard} from "@/components/trainee/TraineeDashboard";

export const metadata: Metadata = {
  title: "Your account",
  description: "Your enquiries, training and saved workshops.",
};

export default function TraineeAccountPage() {
  return <TraineeDashboard />;
}
