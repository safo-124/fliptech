import { Text as NativeText, type TextProps } from "react-native";

import { colors, fonts } from "@/theme/tokens";

type Variant = "display" | "title" | "heading" | "body" | "small" | "label" | "eyebrow";

const VARIANTS = {
  display: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 34, letterSpacing: -0.8, color: colors.foreground },
  title: { fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 27, letterSpacing: -0.5, color: colors.brandDeep },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, letterSpacing: -0.2, color: colors.foreground },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.foreground },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.foreground },
  eyebrow: { fontFamily: fonts.extrabold, fontSize: 11, lineHeight: 14, letterSpacing: 1.6, color: colors.brand },
} as const;

/** Text in the site's type: Inter, in a handful of fixed sizes. */
export function Text({ variant = "body", style, ...props }: TextProps & { variant?: Variant }) {
  return <NativeText maxFontSizeMultiplier={1.4} {...props} style={[VARIANTS[variant], style]} />;
}
