import {
  BookOpen,
  GraduationCap,
  Heart,
  MapPinned,
  PlayCircle,
  Recycle,
  Search,
  ShoppingBag,
  Store,
  UserCheck,
  Users,
  Video,
} from "lucide-react";

import type {NavIconName} from "./types";

const ICONS = {
  training: GraduationCap,
  learn: PlayCircle,
  market: ShoppingBag,
  search: Search,
  map: MapPinned,
  provider: UserCheck,
  courses: Video,
  myCourses: BookOpen,
  trainers: Users,
  used: Recycle,
  saved: Heart,
  sell: Store,
} satisfies Record<NavIconName, unknown>;

export function NavIcon({name, className}: {name: NavIconName; className?: string}) {
  const Icon = ICONS[name];
  return <Icon aria-hidden className={className} strokeWidth={2} />;
}
