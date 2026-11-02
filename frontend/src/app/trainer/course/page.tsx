/**
 * /trainer/course: the course studio. Numbers, lessons, the course page,
 * selling and learners, for the signed-in trainer's own workshop. Under the
 * trainer layout, which brings the CourseStudio messages.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { CourseStudio } from "@/components/trainer/studio/CourseStudio";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CourseStudio");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default function CourseStudioPage() {
  // Suspense: the studio reads its tab from the address (useSearchParams).
  return (
    <Suspense>
      <CourseStudio />
    </Suspense>
  );
}
