"use client";

/**
 * Client boundary for the small map on a listing page.
 *
 * Leaflet and the first tiles come to a hundred kilobytes or so, and on a
 * phone this sits below the courses. So nothing is fetched until it is about
 * to scroll into view: Section 10's page-weight budget is for the page someone
 * opens, not for the part of it they never reach. The Directions link beside
 * it is plain HTML and works before, without and instead of the map.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import type { MapPlace } from "./ProviderLocationMapView";

const LocationMap = dynamic(() => import("./ProviderLocationMapView"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

export function ProviderLocationMap({ place, label }: { place: MapPlace; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      // Start a screen early, so the map is there by the time it is.
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className="relative h-56 bg-[var(--color-muted)]/50 sm:h-64"
    >
      {near ? <LocationMap place={place} /> : null}
    </div>
  );
}
