"use client";

import {Building2, LayoutDashboard, MessageCircle, UserRound} from "lucide-react";
import {useTranslations} from "next-intl";

import type {DashboardTab} from "@/components/dashboard/DashboardNav";

export type TrainerTab = "overview" | "enquiries" | "listing" | "account";

/** The trainer workspace's sections, rendered by the shells in
 *  components/dashboard/DashboardNav.tsx that the trainee account also uses.
 *  Their words are in "TrainerNav". */
const TRAINER_TAB_ICONS = [
  {key: "overview", Icon: LayoutDashboard},
  {key: "enquiries", Icon: MessageCircle},
  {key: "listing", Icon: Building2},
  {key: "account", Icon: UserRound},
] as const satisfies ReadonlyArray<Pick<DashboardTab<TrainerTab>, "key" | "Icon">>;

export const TRAINER_TAB_KEYS: ReadonlyArray<TrainerTab> = TRAINER_TAB_ICONS.map(({key}) => key);

export function useTrainerTabs(): ReadonlyArray<DashboardTab<TrainerTab>> {
  const t = useTranslations("TrainerNav");
  return TRAINER_TAB_ICONS.map(({key, Icon}) => ({
    key,
    Icon,
    label: t(`${key}.label`),
    short: t(`${key}.short`),
  }));
}
