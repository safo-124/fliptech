import { getTranslations } from "next-intl/server";

import type { MapPin } from "@/lib/types";

import { GhanaMapSvg, pinCard } from "./ghana-map/GhanaMap";
import styles from "./ghana-map/GhanaMap.module.css";
import { MapStage, type MapCard } from "./ghana-map/MapStage";
import { summarise } from "./ghana-map/pins";

/**
 * The map in the home page's "Find training" tile: Ghana's regions, towns,
 * Lake Volta and a pin for every listed workshop, kept live (see MapStage).
 * `pins` is null when the API could not be reached: Ghana still shows, with
 * no pins rather than wrong ones.
 */
export async function GhanaMap({ pins, className = "" }: { pins: MapPin[] | null; className?: string }) {
  const t = await getTranslations("LandingPage");
  const all = pins ?? [];
  const regionCounts = new Map(summarise(all).regions.map((region) => [region.slug, region.count]));
  // When the page was drawn; it is cached for minutes, not days.
  const now = new Date();
  const cards: Record<string, MapCard> = Object.fromEntries(all.map((pin) => [pin.id, pinCard(pin, now)]));

  return (
    <div className={className}>
    <MapStage
      cards={cards}
      labels={{
        training: t("mapTagTraining"),
        shop: t("mapTagShop"),
        view: t("mapPinAction"),
        zoom: t("mapGroupAction"),
        group: t("mapGroup", { count: "{count}", place: "{place}" }),
      }}
    >
      <GhanaMapSvg
        pins={all}
        regionCounts={regionCounts}
        now={now}
        labels={{
          label: t("mapLabel"),
          sea: t("mapSea"),
          lake: t("mapLake"),
          regionTip: (region, count) => t("mapRegionTip", { region, count }),
          pinLabel: (pin) => t("mapPinLabel", { name: pin.name, place: pin.area, shop: pin.has_shop ? "yes" : "no" }),
          groupLabel: (count, place) => t("mapGroup", { count, place }),
        }}
      />
      <a href="https://www.amcharts.com/" className={styles.credit} rel="noopener" target="_blank">
        {t("mapCredit")}
      </a>
    </MapStage>
    </div>
  );
}
