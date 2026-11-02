/**
 * /learn/saved: lessons kept on this phone, playable with no signal. The
 * list lives in the browser (lib/offline-lessons.ts), so this page works
 * offline once the service worker has kept it.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SavedLessons } from "@/components/learn/SavedLessons";
import { ClientMessages } from "@/i18n/ClientMessages";
import { LEARN_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Learn");
  return { title: t("savedLessons"), robots: { index: false, follow: false } };
}

export default function SavedLessonsPage() {
  return (
    <ClientMessages namespaces={LEARN_CLIENT_NAMESPACES}>
      <SavedLessons />
    </ClientMessages>
  );
}
