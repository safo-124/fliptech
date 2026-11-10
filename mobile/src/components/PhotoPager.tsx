import { Image } from "expo-image";
import { useState } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { photoUrl } from "@/lib/media";
import { colors } from "@/theme/tokens";

/** Photos to swipe through, full width, with dots for where you are. */
export function PhotoPager({ photos, height = 300 }: { photos: string[]; height?: number }) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  if (!photos.length) return <View style={{ height, backgroundColor: colors.brandDeep }} />;
  return (
    <View style={{ height }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => setPage(Math.round(event.nativeEvent.contentOffset.x / width))}
      >
        {photos.map((photo, index) => (
          <Image
            key={`${photo}-${index}`}
            source={photoUrl(photo, "full")}
            style={{ width, height }}
            contentFit="cover"
            transition={200}
            accessibilityIgnoresInvertColors
          />
        ))}
      </ScrollView>
      {photos.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {photos.map((photo, index) => (
            <View key={`${photo}-dot-${index}`} style={[styles.dot, index === page ? styles.dotOn : null]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { position: "absolute", bottom: 34, alignSelf: "center", flexDirection: "row", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.55)" },
  dotOn: { width: 20, backgroundColor: "#ffffff" },
});
