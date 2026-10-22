import type {Metadata} from "next";
import {getTranslations} from "next-intl/server";

import {TraineeDashboard} from "@/components/trainee/TraineeDashboard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("TraineePages");
  return {title: t("accountTitle"), description: t("accountDescription")};
}

export default function TraineeAccountPage() {
  return <TraineeDashboard />;
}
