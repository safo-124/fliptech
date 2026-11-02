import type { Bounds } from "@/lib/map";
import type { ProviderCard } from "@/lib/types";

export type WorkshopMapProps = {
  workshops: ProviderCard[];
  selectedId: number | null;
  onSelect: (workshop: ProviderCard | null) => void;
  /** The view after it settles; `byUser` is false when the app moved it. */
  onMoved: (bounds: Bounds, byUser: boolean) => void;
  /** Fit the view to a box; a new `nonce` repeats it. */
  fitTo: { bounds: Bounds; nonce: number } | null;
  /** Move to a point, such as the learner's own position. */
  flyTo: { center: [number, number]; zoom: number; nonce: number } | null;
  /** Show the blue dot of where the learner is (after they allowed it). */
  showUser: boolean;
  /** Room the overlays take at the top and bottom, kept clear when fitting. */
  insets: { top: number; bottom: number };
};
