"use client";

import {Building2, LayoutDashboard, MessageCircle} from "lucide-react";

import type {DashboardTab} from "@/components/dashboard/DashboardNav";

export type TrainerTab = "overview" | "enquiries" | "listing";

/** The trainer workspace's sections, rendered by the shells in
 *  components/dashboard/DashboardNav.tsx that the trainee account also uses. */
export const TRAINER_TABS: ReadonlyArray<DashboardTab<TrainerTab>> = [
  {key: "overview", label: "Overview", short: "Home", Icon: LayoutDashboard},
  {key: "enquiries", label: "Enquiries", short: "Enquiries", Icon: MessageCircle},
  {key: "listing", label: "Your listing", short: "Listing", Icon: Building2},
];
