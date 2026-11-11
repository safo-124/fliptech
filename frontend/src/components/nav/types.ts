/** What the header passes its menus: plain, already-translated data. */
export type NavIconName =
  | "training"
  | "learn"
  | "market"
  | "search"
  | "map"
  | "provider"
  | "courses"
  | "myCourses"
  | "trainers"
  | "used"
  | "saved"
  | "sell";

export type NavShortcut = {href: string; label: string; hint: string; icon: NavIconName};

export type NavSection = {
  key: "training" | "learn" | "market";
  href: string;
  label: string;
  icon: NavIconName;
  shortcuts: NavShortcut[];
  /** The panel's right-hand card: one clear next step. */
  feature: {title: string; body: string; cta: string; href: string};
  /** "See all ..." at the foot of the list. */
  allLabel: string;
};

export type NavLabels = {
  mainNavigation: string;
  menu: string;
  close: string;
  search: string;
};
