import { ArrowRight, GraduationCap } from "lucide-react";
import { getImageProps } from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import type { MapPin } from "@/lib/types";

import { GhanaMap, pinCard, star } from "./ghana-map/GhanaMap";
import { MapStage, type MapCard } from "./ghana-map/MapStage";
import { daysSince, summarise } from "./ghana-map/pins";
import styles from "./TrainingMapSection.module.css";

/** Counts are shown once they are big enough to reassure (see page.tsx). */
const MIN_STAT = 10;
/** Rows in "By region". */
const REGION_ROWS = 6;

/**
 * "Find training" on the home page: a live map of Ghana with every listed
 * workshop on it, beside the numbers and the newest arrivals.
 *
 * `pins` is null when the API could not be reached: the map then shows
 * Ghana with no pins and no numbers, rather than numbers that are wrong.
 */
export async function TrainingMapSection({ pins }: { pins: MapPin[] | null }) {
  const t = await getTranslations("LandingPage");
  const all = pins ?? [];
  const summary = summarise(all);
  const regionCounts = new Map(summary.regions.map((region) => [region.slug, region.count]));
  const most = summary.regions[0]?.count ?? 1;
  // Server time when the page was drawn; the page is cached for minutes, not days.
  const now = new Date();
  const cards: Record<string, MapCard> = Object.fromEntries(all.map((pin) => [pin.id, pinCard(pin, now)]));

  return (
    <section className={`app-shell mt-10 sm:mt-12`} aria-labelledby="find-training">
      <MapStage
        className={styles.panel}
        cards={cards}
        labels={{
          training: t("mapTagTraining"),
          shop: t("mapTagShop"),
          view: t("mapPinAction"),
          zoom: t("mapGroupAction"),
          group: t("mapGroup", { count: "{count}", place: "{place}" }),
        }}
      >
        <div className={styles.text}>
          <span className={styles.icon}>
            <GraduationCap aria-hidden="true" className="size-5" />
          </span>
          <h2 id="find-training" className={styles.title}>
            {t("pillarTrainingTitle")}
          </h2>
          <p className={styles.body}>{t("pillarTrainingBody")}</p>
          {pins ? (
            <p className={styles.live}>
              <span className={styles.liveDot} aria-hidden="true" />
              {t("mapLive")}
              <span className={styles.liveNote}>· {t("mapLiveNote")}</span>
            </p>
          ) : null}

          {summary.workshops >= MIN_STAT ? (
            <dl className={styles.stats}>
              <div>
                <dt>{t("mapStatWorkshops", { count: summary.workshops })}</dt>
                <dd>{summary.workshops}</dd>
              </div>
              {summary.shops ? (
                <div>
                  <dt>{t("mapStatShops")}</dt>
                  <dd>{summary.shops}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t("mapStatRegions", { count: summary.regions.length })}</dt>
                <dd>{summary.regions.length}</dd>
              </div>
            </dl>
          ) : null}

          {summary.regions.length ? (
            <div className={styles.block}>
              <h3 className={styles.blockTitle}>{t("mapByRegion")}</h3>
              <ul className={styles.regions}>
                {summary.regions.slice(0, REGION_ROWS).map((region) => (
                  <li key={region.slug}>
                    <Link href={`/training?region=${region.slug}`} className={styles.regionRow} data-region-row={region.slug}>
                      <span className={styles.regionName}>{region.name}</span>
                      <span className={styles.bar} aria-hidden="true">
                        <i style={{ width: `${(region.count / most) * 100}%` }} />
                      </span>
                      <span className={styles.count}>{region.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary.newest.length ? (
            <div className={`${styles.block} ${styles.newest}`}>
              <h3 className={styles.blockTitle}>{t("mapJustJoined")}</h3>
              <ul>
                {summary.newest.map((pin) => {
                  const days = daysSince(pin.joined, now);
                  return (
                    <li key={pin.id}>
                      <Link href={`/${pin.area_slug}/${pin.slug}`} className={styles.joined}>
                        {pin.primary_photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- decorative, and already sized by the optimiser
                          <img {...avatar(pin.primary_photo)} alt="" className={styles.avatar} />
                        ) : (
                          <span className={styles.avatar} aria-hidden="true">
                            {pin.name.trim()[0]?.toUpperCase()}
                          </span>
                        )}
                        <span className={styles.joinedText}>
                          <span className={styles.joinedName}>{pin.name}</span>
                          <span className={styles.joinedMeta}>
                            {[pin.trade?.name, pin.area].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className={styles.ago}>
                          {days === 0 ? t("mapJoinedToday") : t("mapJoinedDaysAgo", { count: days })}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <Link href="/training" className={styles.action}>
            {t("pillarTrainingAction")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>

        <figure className={styles.map}>
          <GhanaMap
            pins={all}
            regionCounts={regionCounts}
            now={now}
            labels={{
              label: t("mapLabel"),
              sea: t("mapSea"),
              lake: t("mapLake"),
              regionTip: (region, count) => t("mapRegionTip", { region, count }),
              pinLabel: (pin) =>
                t("mapPinLabel", {
                  name: pin.name,
                  place: pin.area,
                  shop: pin.has_shop ? "yes" : "no",
                }),
              groupLabel: (count, place) => t("mapGroup", { count, place }),
            }}
          />
          <figcaption className={styles.legend}>
            <span>
              <i className={styles.keyWorkshop} aria-hidden="true" />
              {t("mapLegendWorkshop")}
            </span>
            <span>
              <i className={styles.keyShop} aria-hidden="true" />
              {t("mapLegendShop")}
            </span>
            <span>
              <svg viewBox="0 0 12 12" aria-hidden="true" className={styles.keyStar}>
                <path d={star(6, 6.4, 6)} />
              </svg>
              {t("mapLegendCapital")}
            </span>
            <span>
              <i className={styles.keyRegional} aria-hidden="true" />
              {t("mapLegendRegional")}
            </span>
            <span className={styles.keyTownWrap}>
              <i className={styles.keyTown} aria-hidden="true" />
              {t("mapLegendTown")}
            </span>
            <a href="https://www.amcharts.com/" className={styles.credit} rel="noopener" target="_blank">
              {t("mapCredit")}
            </a>
          </figcaption>
        </figure>
      </MapStage>
    </section>
  );
}

function avatar(url: string) {
  const { props } = getImageProps({ src: url, alt: "", width: 36, height: 36, quality: 70 });
  return { src: props.src, srcSet: props.srcSet, width: 36, height: 36, loading: "lazy" as const };
}
