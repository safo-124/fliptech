/**
 * /learn/mine: every course this trainee has started or bought, with how
 * far, where to carry on, and their certificates. Personal, so never kept
 * by the service worker and never indexed.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { MyCourses } from "@/components/learn/MyCourses";
import { ClientMessages } from "@/i18n/ClientMessages";
import { LEARN_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Learn");
  return { title: t("myCourses"), robots: { index: false, follow: false } };
}

export default function MyCoursesPage() {
  return (
    <ClientMessages namespaces={LEARN_CLIENT_NAMESPACES}>
      <MyCourses />
    </ClientMessages>
  );
}
