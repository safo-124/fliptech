/**
 * Reanimated for Jest: animations settle at once.
 *
 * Reanimated's own mock cannot load under Jest in this SDK
 * ("setCSSEventHandler is not available in JSReanimated"), and expo-router's
^ * testing library then falls back to an empty module. package.json maps
 * both `react-native-reanimated` and its `/mock` to thin files over this one.
 */
import { Image, ScrollView, Text, View } from "react-native";

const now = <T>(value: T) => value;

const Animated = {
  View,
  Text,
  Image,
  ScrollView,
  createAnimatedComponent: <T>(component: T) => component,
  call: () => {},
};

export default Animated;
export const useAnimatedStyle = (style: () => object) => style();
export const useSharedValue = <T>(value: T) => ({ value, get: () => value, set: () => {} });
export const useAnimatedProps = (props: () => object) => props();
export const useDerivedValue = <T>(derive: () => T) => ({ value: derive(), get: derive });
export const withSpring = now;
export const withTiming = now;
export const withRepeat = now;
export const withDelay = (_: number, value: unknown) => value;
export const runOnJS = <T>(fn: T) => fn;
export const Easing = { linear: now, ease: now, inOut: () => now, out: () => now, in: () => now };
