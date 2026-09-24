"use client";

import {Bookmark, GraduationCap, LayoutDashboard, Send, Settings} from "lucide-react";

import type {DashboardTab} from "@/components/dashboard/DashboardNav";

export type TraineeTab = "overview" | "enquiries" | "training" | "saved" | "settings";

/** The trainee account's sections. The shells that render them are shared with
 *  the trainer workspace — see components/dashboard/DashboardNav.tsx. */
export const TRAINEE_TABS: ReadonlyArray<DashboardTab<TraineeTab>> = [
  {key: "overview", label: "Overview", short: "Home", Icon: LayoutDashboard},
  {key: "enquiries", label: "Enquiries", short: "Sent", Icon: Send},
  {key: "training", label: "My training", short: "Training", Icon: GraduationCap},
  {key: "saved", label: "Saved", short: "Saved", Icon: Bookmark},
  {key: "settings", label: "Settings", short: "Settings", Icon: Settings},
];
