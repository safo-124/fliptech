"use client";

/**
 * Client boundary for the workshop location map.
 *
 * Leaflet reads `window` at import time, so it cannot be part of the wizard's
 * own bundle. The same arrangement as MapLoader on the public site: the
 * dynamic import with `ssr: false` lives in its own client component.
 *
 * If the map fails to load — an old browser, a blocked tile host, a flaky
 * connection on the roadside — the wizard still works. The coordinate inputs
 * next to it are the real control; this only makes them easier to get right.
 */

import dynamic from "next/dynamic";
import {MapPinned} from "lucide-react";
import {Component, type ErrorInfo, type ReactNode} from "react";

import {Skeleton} from "@/components/ui/skeleton";

import type {LatLng} from "./LocationPicker";

function PickerPlaceholder({message}: {message: string}) {
  return (
    <div
      className="relative grid h-64 place-items-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/35 px-6 text-center"
      role="status"
    >
      <Skeleton className="absolute inset-0 rounded-none opacity-60" />
      <div className="relative">
        <span
          className="mx-auto grid size-10 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)]"
          aria-hidden="true"
        >
          <MapPinned className="size-5" />
        </span>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">{message}</p>
      </div>
    </div>
  );
}

const LocationPicker = dynamic(() => import("./LocationPicker"), {
  ssr: false,
  loading: () => <PickerPlaceholder message="Loading map…" />,
});

class PickerBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("The workshop location map failed to start", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <PickerPlaceholder message="The map could not load. Enter the coordinates below instead." />
      );
    }
    return this.props.children;
  }
}

export function LocationPickerField(props: {
  latitude: string;
  longitude: string;
  areaCentroid?: LatLng | null;
  onChange: (next: LatLng) => void;
}) {
  return (
    <PickerBoundary>
      <LocationPicker {...props} />
    </PickerBoundary>
  );
}
