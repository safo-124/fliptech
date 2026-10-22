"use client";

import {Bookmark, GraduationCap, LayoutDashboard, Send, Settings} from "lucide-react";
import {useTranslations} from "next-intl";

import type {DashboardTab} from "@/components/dashboard/DashboardNav";

export type TraineeTab = "overview" | "enquiries" | "training" | "saved" | "settings";

/** The trainee account's sections, in order. Their words — a label for the
 *  sidebar and a short one for the bottom bar — are in "TraineeNav". The
 *  shells that render them are shared with the trainer workspace; see
 *  components/dashboard/DashboardNav.tsx. */
const TRAINEE_TAB_ICONS = [
  {key: "overview", Icon: LayoutDashboard},
  {key: "enquiries", Icon: Send},
  {key: "training", Icon: GraduationCap},
  {key: "saved", Icon: Bookmark},
  {key: "settings", Icon: Settings},
] as const satisfies ReadonlyArray<Pick<DashboardTab<TraineeTab>, "key" | "Icon">>;

export function useTraineeTabs(): ReadonlyArray<DashboardTab<TraineeTab>> {
  const t = useTranslations("TraineeNav");
  return TRAINEE_TAB_ICONS.map(({key, Icon}) => ({
    key,
    Icon,
    label: t(`${key}.label`),
    short: t(`${key}.short`),
  }));
}
