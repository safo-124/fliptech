"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import styles from "./GhanaMap.module.css";

/** What a pin's hover card shows. */
export type MapCard = {
  name: string;
  meta: string;
  photo: string | null;
  shop: boolean;
  href: string;
  fresh: boolean;
};

/** How often an open home page asks the server for the latest pins. */
const REFRESH_MS = 2 * 60 * 1000;

type Spot = { x: number; y: number; below: boolean };
type Shown =
  | ({ kind: "card"; card: MapCard } & Spot)
  | ({ kind: "group"; title: string; photo: string | null } & Spot)
  | ({ kind: "tip"; text: string } & Spot);

/** Half a card's width, in pixels: how far a card reaches either side of its pin. */
const HALF_CARD = 120;
/** A pin nearer the top than this gets its card below it, inside the tile. */
const ROOM_ABOVE = 190;

/**
 * The live part of the map: hover cards for pins, a name and count for each
 * region, and a quiet refresh every
 * two minutes while the page is on screen, so a workshop that joins while
 * someone is looking appears without a reload. Everything here is extra: the
 * map underneath is plain links (GhanaMap).
 */
export function MapStage({
  cards,
  labels,
  children,
  className,
}: {
  cards: Record<string, MapCard>;
  labels: {
    training: string;
    shop: string;
    view: string;
    zoom: string;
    /** "{count} workshops in {place}": a template, because a function cannot cross to the browser. */
    group: string;
  };
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const stage = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  /** Where a card goes: over the pin, or under it near the top, and never
      past the map's sides, since the tile around it clips what spills out. */
  function spot(element: Element): Spot {
    const box = stage.current!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const centre = rect.left + rect.width / 2 - box.left;
    const x = box.width > HALF_CARD * 2 ? Math.min(Math.max(centre, HALF_CARD), box.width - HALF_CARD) : box.width / 2;
    const top = rect.top - box.top;
    return top < ROOM_ABOVE ? { x, y: rect.bottom - box.top, below: true } : { x, y: top, below: false };
  }

  function show(target: EventTarget | null, pointer?: { clientX: number; clientY: number }) {
    if (!(target instanceof Element) || !stage.current) return;
    const pin = target.closest("[data-pin]");
    if (pin) {
      const card = cards[pin.getAttribute("data-pin")!];
      if (card) setShown({ kind: "card", card, ...spot(pin) });
      return;
    }
    const group = target.closest("[data-group]");
    if (group) {
      const ids = group.getAttribute("data-group")!.split(",");
      const photo = ids.map((id) => cards[id]?.photo).find(Boolean) ?? null;
      setShown({ kind: "group", title: labels.group.replace("{count}", String(ids.length)).replace("{place}", group.getAttribute("data-place") ?? ""), photo, ...spot(group) });
      return;
    }
    const region = target.closest("[data-tip]");
    if (region && pointer) {
      const box = stage.current.getBoundingClientRect();
      const y = pointer.clientY - box.top;
      setShown({ kind: "tip", text: region.getAttribute("data-tip")!, x: pointer.clientX - box.left, y, below: y < 40 });
      return;
    }
    setShown(null);
  }

  return (
    <div
      ref={stage}
      className={`${styles.stage} ${className ?? ""}`}
      // A finger's tap follows the link; only a mouse or the keyboard gets the card.
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") show(event.target, event);
      }}
      onPointerLeave={() => setShown(null)}
      onFocus={(event) => show(event.target)}
      onBlur={() => setShown(null)}
    >
      {children}
      {shown?.kind === "tip" ? (
        <div
          className={`${styles.tip} ${shown.below ? styles.below : ""}`}
          style={{ left: shown.x, top: shown.y }}
          aria-hidden="true"
        >
          {shown.text}
        </div>
      ) : shown ? (
        <div
          className={`${styles.card} ${shown.below ? styles.below : ""}`}
          style={{ left: shown.x, top: shown.y }}
          aria-hidden="true"
        >
          {shown.kind === "card" ? (
            <>
              {shown.card.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- already sized by the optimiser
                <img src={shown.card.photo} alt="" className={styles.cardPhoto} />
              ) : null}
              <div className={styles.cardBody}>
                <p className={styles.cardName}>{shown.card.name}</p>
                <p className={styles.cardMeta}>{shown.card.meta}</p>
                <p className={styles.cardTags}>
                  <span className={styles.tag}>{labels.training}</span>
                  {shown.card.shop ? <span className={`${styles.tag} ${styles.tagShop}`}>{labels.shop}</span> : null}
                </p>
                <p className={styles.cardAction}>{labels.view} →</p>
              </div>
            </>
          ) : (
            <>
              {shown.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- already sized by the optimiser
                <img src={shown.photo} alt="" className={styles.cardPhoto} />
              ) : null}
              <div className={styles.cardBody}>
                <p className={styles.cardName}>{shown.title}</p>
                <p className={styles.cardAction}>{labels.zoom} →</p>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
