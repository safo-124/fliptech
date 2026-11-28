/**
 * Home's slideshow of shops, as on the website's front page: up to five
 * shops taking turns (backend HeroShopsView: three items or more and a photo,
 * trainers' shops first, a new set each hour). One picture per shop with its
 * name, town and a "Trainer" badge; a tap opens the shop.
 *
 * A new picture every 5 seconds, unless a finger is on it, the system asks
 * for reduced motion, or the data saver is on (then it turns only by swipe,
 * so no picture is fetched that nobody asked for). Swiping works always.
 */

import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { dataSaving } from "@/lib/datasaver";
import { photoUrl } from "@/lib/media";
import type { HeroShop } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

const TURN_MS = 5000;
const GAP = space.md;

export function ShopSlideshow() {
  const shops = useQuery({ queryKey: ["hero-shops"], queryFn: api.heroShops, staleTime: 5 * 60_000 });
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const card = width - space.lg * 2;
  const list = useRef<FlatList<HeroShop>>(null);
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const items = shops.data?.results ?? [];
  const turning = items.length > 1 && !held && !reduced && !dataSaving();

  useEffect(() => {
    if (!turning) return;
    const timer = setTimeout(() => {
      const next = (index + 1) % items.length;
      list.current?.scrollToOffset({ offset: next * (card + GAP), animated: true });
      setIndex(next);
    }, TURN_MS);
    return () => clearTimeout(timer);
  }, [turning, index, items.length, card]);

  if (!items.length) return null;

  return (
    <View style={styles.wrap} accessibilityLabel="Shops on Fliiptech">
      <FlatList
        ref={list}
        data={items}
        horizontal
        keyExtractor={(shop) => String(shop.id)}
        showsHorizontalScrollIndicator={false}
        snapToInterval={card + GAP}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: GAP }}
        onScrollBeginDrag={() => setHeld(true)}
        onMomentumScrollEnd={(event) => {
          setIndex(Math.max(0, Math.min(items.length - 1, Math.round(event.nativeEvent.contentOffset.x / (card + GAP)))));
          setHeld(false);
        }}
        renderItem={({ item, index: position }) => (
          <Pressable
            onPress={() => router.push(`/shop/${item.id}`)}
            style={({ pressed }) => [styles.card, { width: card }, pressed ? { opacity: 0.92 } : null]}
            accessibilityRole="button"
            accessibilityLabel={`${item.business_name}, ${item.area}${item.is_trainer ? ", trainer" : ""}. Visit shop. ${position + 1} of ${items.length}`}
          >
            <Image
              source={photoUrl(item.photo)}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
              priority={position === 0 ? "high" : "normal"}
            />
            <View style={styles.caption}>
              {item.is_trainer ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>TRAINER</Text>
                </View>
              ) : null}
              <Text style={styles.name} numberOfLines={1}>
                {item.business_name}, {item.area}
              </Text>
            </View>
          </Pressable>
        )}
      />
      {items.length > 1 ? (
        <View style={styles.dots}>
          {items.map((shop, position) => (
            <View key={shop.id} style={[styles.dot, position === index ? styles.dotOn : null]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.lg, gap: space.sm },
  card: {
    aspectRatio: 4 / 3,
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.muted,
    justifyContent: "flex-end",
  },
  caption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    maxWidth: "92%",
    margin: space.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  badge: { borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: "rgba(255,255,255,0.92)" },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.5, color: colors.brandDeep },
  name: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 13, color: "#ffffff" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 16, backgroundColor: colors.brand },
});
