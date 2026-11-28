/**
 * The Fliiptech mark with two big eyes, as on the website's messages button.
 * The petals are the logo's own (lib/brand-mark.ts); the eyes sit in the
 * ring's open middle (lib/watching-eyes.ts) as plain views over the drawing,
 * so the pupils and the blink move on the UI thread (Reanimated).
 *
 * A phone has no pointer, so:
 * - the eyes glance towards a tap on the screen (`tap`), then back;
 * - when a new message arrives (`count` goes up) they look up at the count;
 * - left alone, they look around now and then, and blink every few seconds.
 * With the system's "reduce motion" on, they stay still, looking ahead.
 */

import { useEffect, useRef, type ComponentRef } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, G, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";

import { MARK_COLOURS, MARK_GRADIENT, MARK_HIGHLIGHT, PETAL_PATHS } from "@/lib/brand-mark";
import { EYE_RADIUS, EYES, GLANCE_BADGE, PUPIL_RADIUS, REACH, pupilOffset } from "@/lib/watching-eyes";

const HOLD_MS = 1500;
const WANDER_EVERY_MS = 5000;
const IDLE_MS = 6000;

/** The point between the eyes: one look for both, so they never cross. */
const MIDDLE = { cx: (EYES[0].cx + EYES[1].cx) / 2, cy: EYES[0].cy };

export function WatchingMark({
  size = 34,
  count = 0,
  tap = null,
}: {
  size?: number;
  /** The unread count: when it goes up, a glance at it. */
  count?: number;
  /** The last tap on the screen, in window coordinates. */
  tap?: { x: number; y: number; at: number } | null;
}) {
  const reduced = useReducedMotion();
  const scale = size / 48;
  const box = useRef<ComponentRef<typeof View>>(null);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const lid = useSharedValue(1);
  const lastLook = useRef(0);
  const shownCount = useRef(count);

  const pupilStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));
  const lidStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: lid.get() }] }));

  // In grid units, then back to straight ahead after a moment.
  function glance(offset: { x: number; y: number }, hold = HOLD_MS) {
    lastLook.current = Date.now();
    x.set(withSequence(withTiming(offset.x * scale, { duration: 160 }), withDelay(hold, withTiming(0, { duration: 260 }))));
    y.set(withSequence(withTiming(offset.y * scale, { duration: 160 }), withDelay(hold, withTiming(0, { duration: 260 }))));
  }

  // A blink every few seconds.
  useEffect(() => {
    if (reduced) return;
    lid.set(withRepeat(withSequence(withDelay(4200, withTiming(0.06, { duration: 90 })), withTiming(1, { duration: 110 })), -1));
  }, [reduced, lid]);

  // Left alone: a look around now and then.
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      if (Date.now() - lastLook.current < IDLE_MS) return;
      const angle = Math.random() * Math.PI * 2;
      const pull = REACH * (0.5 + Math.random() * 0.5);
      glance({ x: Math.cos(angle) * pull, y: Math.sin(angle) * pull }, 1100);
    }, WANDER_EVERY_MS);
    return () => clearInterval(timer);
    // glance only reads refs and shared values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, scale]);

  // A tap somewhere on the screen: a glance towards it.
  useEffect(() => {
    if (reduced || !tap) return;
    box.current?.measureInWindow((left: number, top: number, width: number) => {
      if (!width) return;
      glance(pupilOffset(MIDDLE, tap, { left, top, width }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tap, reduced]);

  // A new message: a look up at the count.
  useEffect(() => {
    const before = shownCount.current;
    shownCount.current = count;
    if (reduced || count <= before) return;
    glance(GLANCE_BADGE, 1700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, reduced]);

  const { x1, y1, x2, y2 } = MARK_GRADIENT;
  const { cx, cy, r, from, opacity } = MARK_HIGHLIGHT;
  const eye = EYE_RADIUS * 2 * scale;
  const pupil = PUPIL_RADIUS * 2 * scale;
  return (
    <View ref={box} style={{ width: size, height: size }} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Defs>
          <LinearGradient id="watch-gradient" x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={MARK_COLOURS.start} />
            <Stop offset="0.5" stopColor={MARK_COLOURS.middle} />
            <Stop offset="1" stopColor={MARK_COLOURS.end} />
          </LinearGradient>
          <RadialGradient id="watch-highlight" cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
            <Stop offset={from} stopColor="#ffffff" stopOpacity={opacity} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <G fill="url(#watch-gradient)">
          {PETAL_PATHS.map((d) => (
            <Path key={d} d={d} />
          ))}
        </G>
        <G fill="url(#watch-highlight)">
          {PETAL_PATHS.map((d) => (
            <Path key={d} d={d} />
          ))}
        </G>
      </Svg>
      {EYES.map((spot) => (
        <Animated.View
          key={spot.cx}
          style={[
            {
              position: "absolute",
              left: (spot.cx - EYE_RADIUS) * scale,
              top: (spot.cy - EYE_RADIUS) * scale,
              width: eye,
              height: eye,
              borderRadius: eye / 2,
              backgroundColor: "#ffffff",
              borderWidth: Math.max(0.5, 0.35 * scale),
              borderColor: "#e2dcf6",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            },
            lidStyle,
          ]}
        >
          <Animated.View style={[{ width: pupil, height: pupil, borderRadius: pupil / 2, backgroundColor: "#24223a" }, pupilStyle]}>
            <View
              style={{
                position: "absolute",
                left: pupil / 2 + 0.6 * scale - 0.55 * scale,
                top: pupil / 2 - 0.65 * scale - 0.55 * scale,
                width: 1.1 * scale,
                height: 1.1 * scale,
                borderRadius: 0.55 * scale,
                backgroundColor: "#ffffff",
              }}
            />
          </Animated.View>
        </Animated.View>
      ))}
    </View>
  );
}
