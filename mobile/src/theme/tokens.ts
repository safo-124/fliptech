/**
 * The website's colours, in hex for React Native.
 *
 * Converted from the oklch tokens in frontend/src/app/globals.css, so the
 * app and the site are one brand. Change a colour there, convert it, and
 * change it here: the two are meant to match.
 */
export const colors = {
  background: "#fbf9f5",
  card: "#ffffff",
  foreground: "#171426",
  muted: "#f3f0e9",
  mutedForeground: "#57616f",
  border: "#e0dcd4",
  borderStrong: "#cac3b7",
  brand: "#581cb1",
  brandStrong: "#3d0083",
  brandDeep: "#26005a",
  brandGlow: "#491889",
  brandSoft: "#f2edff",
  brandViolet: "#9867e1",
  brandPink: "#f072b3",
  sand: "#f3dca5",
  peach: "#ecb38c",
  coral: "#e08576",
  visit: "#077045",
  visitBg: "#e7f6ed",
  warn: "#8d5e00",
  warnBg: "#fef4df",
  destructive: "#e7000b",
} as const;

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  extrabold: "Inter_800ExtraBold",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** A soft card shadow that reads the same on Android (elevation) and iOS. */
export const shadow = {
  card: {
    shadowColor: "#26005a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  floating: {
    shadowColor: "#26005a",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
} as const;
