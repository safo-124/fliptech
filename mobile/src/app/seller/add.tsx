import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { Camera, Check, ChevronDown, Copy, Hammer, ImagePlus, RotateCcw, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { Text } from "@/components/Text";
import { ApiError, api, uploadPendingPhoto } from "@/lib/api";
import { blankDraft, likeThis, nameExample, toInput, wasPriceTooLow, type QuickItemDraft } from "@/lib/quick-item";
import { mayOpenGallery } from "@/lib/store-rules";
import type { CreatedProduct } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

const MAX_PHOTOS = 6;

type Shot = {
  key: string;
  uri: string;
  mimeType: string;
  progress: number;
  state: "uploading" | "done" | "failed";
  id?: number;
};

/**
 * "Add an item", photo first, for a seller with a customer in front of them.
 * The same flow as the website's (frontend QuickAddItem.tsx): the camera
 * opens straight away, each photo uploads as it is taken, and the screen
 * asks only for a name, a price and two big buttons. "Put on sale" saves and
 * publishes in one request. `like` (a saved item, as JSON) starts a new one
 * like it, without its photos.
 */
export default function AddItemScreen() {
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ like?: string }>();
  const shop = useQuery({ queryKey: ["seller-account"], queryFn: api.sellerAccount });
  const trades = useQuery({ queryKey: ["trades"], queryFn: api.trades });
  const startTrade = shop.data?.workshop?.trade_id ?? null;

  const [draft, setDraft] = useState<QuickItemDraft>(() => {
    if (params.like) {
      try {
        return JSON.parse(params.like) as QuickItemDraft;
      } catch {
        // Not a draft: start blank.
      }
    }
    return blankDraft(null);
  });
  // The trade: the seller's own choice once they make one, else the
  // workshop's (known once the shop has loaded).
  const [tradeChosen, setTradeChosen] = useState(Boolean(params.like));
  const trade = tradeChosen ? draft.trade : startTrade;

  const [shots, setShots] = useState<Shot[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<"sale" | "draft" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [nameMissing, setNameMissing] = useState(false);
  const [saved, setSaved] = useState<CreatedProduct | null>(null);
  const count = useRef(0);

  const set = <K extends keyof QuickItemDraft>(key: K, value: QuickItemDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const patch = (key: string, change: Partial<Shot>) =>
    setShots((current) => current.map((shot) => (shot.key === key ? { ...shot, ...change } : shot)));

  async function send(shot: Shot) {
    patch(shot.key, { state: "uploading", progress: 0 });
    try {
      const uploaded = await uploadPendingPhoto(shot.uri, shot.mimeType, (share) => patch(shot.key, { progress: share }));
      patch(shot.key, { state: "done", progress: 1, id: uploaded.id });
    } catch {
      patch(shot.key, { state: "failed" });
    }
  }

  async function take(from: "camera" | "library") {
    const room = MAX_PHOTOS - count.current;
    if (room <= 0) return;
    const allowed = from === "camera" ? (await ImagePicker.requestCameraPermissionsAsync()).granted : await mayOpenGallery();
    if (!allowed) {
      Alert.alert("Allow access", "Fliiptech needs permission to use the camera or your photos for this. You can allow it in your phone's settings.");
      return;
    }
    // quality 0.8: a JPEG a fraction of the camera's size; the server keeps
    // no more than its maximum size either way.
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: from === "library",
      selectionLimit: room,
    };
    const result =
      from === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    for (const asset of result.assets.slice(0, room)) {
      count.current += 1;
      const shot: Shot = {
        key: `${Date.now()}-${Math.random()}`,
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
        progress: 0,
        state: "uploading",
      };
      // Shown at once, from the phone's own copy.
      setShots((current) => [...current, shot]);
      void send(shot);
    }
  }

  // The camera opens as the screen does, for a new item.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || params.like) return;
    opened.current = true;
    void take("camera");
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addPhoto() {
    Alert.alert("Add a photo", undefined, [
      { text: "Take a photo", onPress: () => void take("camera") },
      { text: "Choose from gallery", onPress: () => void take("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function remove(shot: Shot) {
    count.current -= 1;
    setShots((current) => current.filter((item) => item.key !== shot.key));
    if (shot.id) void api.removePendingPhoto(shot.id).catch(() => {});
  }

  async function save(publish: boolean) {
    setProblem(null);
    if (!draft.name.trim()) {
      setNameMissing(true);
      return;
    }
    if (shots.some((shot) => shot.state === "uploading")) {
      setProblem("A photo is still uploading. Wait a moment, then try again.");
      return;
    }
    setBusy(publish ? "sale" : "draft");
    try {
      const photos = shots.flatMap((shot) => (shot.state === "done" && shot.id ? [shot.id] : []));
      const product = await api.createSellerProduct(toInput({ ...draft, trade }, photos, publish));
      void client.invalidateQueries({ queryKey: ["seller-products"] });
      setSaved(product);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That did not save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const tradeSlug = trades.data?.results.find((item) => item.id === trade)?.slug;
  const tooLow = wasPriceTooLow(draft);

  if (saved) {
    return (
      <View style={styles.screen}>
        <StackHeader eyebrow="MY SHOP" title={saved.status === "published" ? "On sale" : "Saved as a draft"} />
        <View style={{ padding: space.lg, gap: space.md }}>
          <View style={styles.card}>
            <Text variant="heading">{saved.name}</Text>
            {saved.not_published ? <Text variant="small">{saved.not_published.detail}</Text> : null}
          </View>
          <Button
            label="Add another like this"
            icon={<Copy size={18} color="#fff" />}
            onPress={() =>
              router.replace({ pathname: "/seller/add", params: { like: JSON.stringify(likeThis(saved)) } })
            }
          />
          <Button label="Done" tone="outline" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const choice = (selected: boolean) => [styles.choice, selected ? styles.choiceOn : null];

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="MY SHOP" title="Add an item" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}
        >
          <View style={{ gap: space.sm }}>
            <Text variant="label">{`Photos (${shots.length} of ${MAX_PHOTOS})`}</Text>
            <View style={styles.grid}>
              {shots.map((shot, index) => (
                <View key={shot.key} style={styles.tile}>
                  <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`Photo ${index + 1}`} />
                  {shot.state === "uploading" ? (
                    <View style={styles.bar}>
                      <View style={[styles.barFill, { width: `${Math.max(8, Math.round(shot.progress * 100))}%` }]} />
                    </View>
                  ) : null}
                  {shot.state === "done" ? (
                    <View style={styles.done} accessibilityLabel="Uploaded">
                      <Check size={14} color="#fff" />
                    </View>
                  ) : null}
                  {shot.state === "failed" ? (
                    <Pressable style={styles.failed} onPress={() => void send(shot)} accessibilityRole="button" accessibilityLabel="Try the upload again">
                      <RotateCcw size={20} color="#fff" />
                      <Text style={styles.failedText}>Try again</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.remove} onPress={() => remove(shot)} accessibilityRole="button" accessibilityLabel={`Remove photo ${index + 1}`} hitSlop={8}>
                    <X size={16} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {shots.length < MAX_PHOTOS ? (
                <Pressable style={[styles.tile, styles.addTile]} onPress={addPhoto} accessibilityRole="button" accessibilityLabel="Add a photo">
                  {shots.length ? <ImagePlus size={24} color={colors.mutedForeground} /> : <Camera size={24} color={colors.mutedForeground} />}
                  <Text variant="small">{shots.length ? "Add photo" : "Take a photo"}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <Field
            label="What is it?"
            value={draft.name}
            onChangeText={(text) => {
              set("name", text);
              if (text.trim()) setNameMissing(false);
            }}
            placeholder={nameExample(tradeSlug, "Handmade Ankara bag")}
            maxLength={200}
            error={nameMissing ? "Give the item a name." : undefined}
          />
          <Field
            label="Price (optional)"
            prefix="GH₵"
            value={draft.price}
            onChangeText={(text) => set("price", text)}
            keyboardType="decimal-pad"
            placeholder="1,200"
            hint="Leave it empty and buyers see “Ask for price”."
          />

          <View style={{ gap: space.sm }}>
            <Text variant="label">Can someone buy it today?</Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Pressable
                style={choice(draft.availability === "available")}
                onPress={() => set("availability", "available")}
                accessibilityRole="button"
                accessibilityState={{ selected: draft.availability === "available" }}
              >
                <Check size={20} color={draft.availability === "available" ? colors.brand : colors.foreground} />
                <Text style={[styles.choiceText, draft.availability === "available" ? styles.choiceTextOn : null]}>Ready now</Text>
              </Pressable>
              <Pressable
                style={choice(draft.availability === "made_to_order")}
                onPress={() => set("availability", "made_to_order")}
                accessibilityRole="button"
                accessibilityState={{ selected: draft.availability === "made_to_order" }}
              >
                <Hammer size={20} color={draft.availability === "made_to_order" ? colors.brand : colors.foreground} />
                <Text style={[styles.choiceText, draft.availability === "made_to_order" ? styles.choiceTextOn : null]}>Made to order</Text>
              </Pressable>
            </View>
          </View>

          <Pressable style={styles.more} onPress={() => setMore((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: more }}>
            <Text variant="label">More details (optional)</Text>
            <ChevronDown size={18} color={colors.foreground} style={more ? { transform: [{ rotate: "180deg" }] } : undefined} />
          </Pressable>
          {more ? (
            <View style={{ gap: space.lg }}>
              <Field
                label="Describe it"
                value={draft.description}
                onChangeText={(text) => set("description", text)}
                multiline
                hint="Tap the mic on your keyboard to speak instead of typing."
              />
              <Field
                label="How many do you have?"
                value={draft.stock}
                onChangeText={(text) => set("stock", text.replace(/\D/g, ""))}
                keyboardType="number-pad"
                placeholder="Not counted"
              />
              {draft.availability === "made_to_order" ? (
                <Field
                  label="Days to make (optional)"
                  value={draft.makeDays}
                  onChangeText={(text) => set("makeDays", text.replace(/\D/g, "").slice(0, 3))}
                  keyboardType="number-pad"
                  hint={'Buyers see "About N days to make".'}
                />
              ) : null}
              <View style={{ gap: space.sm }}>
                <Text variant="label">Condition</Text>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  {(["new", "used"] as const).map((value) => (
                    <Pressable
                      key={value}
                      style={choice(draft.condition === value)}
                      onPress={() => set("condition", value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: draft.condition === value }}
                    >
                      <Text style={[styles.choiceText, draft.condition === value ? styles.choiceTextOn : null]}>
                        {value === "new" ? "New" : "Used"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Field
                label="Price before the sale"
                prefix="GH₵"
                value={draft.wasPrice}
                onChangeText={(text) => set("wasPrice", text)}
                keyboardType="decimal-pad"
                error={tooLow ? "This is not higher than the price, so it will not show as a sale." : undefined}
                hint="Shown crossed out next to the price."
              />
              <Field
                label="Sizes or colours"
                value={draft.options}
                onChangeText={(text) => set("options", text)}
                placeholder="Small, Medium, Large"
              />
              {trades.data?.results.length ? (
                <View style={{ gap: space.sm }}>
                  <Text variant="label">Trade</Text>
                  <View style={styles.chips}>
                    {trades.data.results.map((item) => (
                      <Pressable
                        key={item.id}
                        style={[styles.chip, trade === item.id ? styles.chipOn : null]}
                        onPress={() => {
                          setTradeChosen(true);
                          set("trade", trade === item.id ? null : item.id);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: trade === item.id }}
                      >
                        <Text style={[styles.chipText, trade === item.id ? styles.choiceTextOn : null]}>{item.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          <FormError message={problem} />
          <Button label="Put on sale" busy={busy === "sale"} disabled={busy !== null} onPress={() => void save(true)} />
          <Pressable style={styles.draftLink} onPress={() => void save(false)} disabled={busy !== null} accessibilityRole="button">
            <Text style={styles.draftText}>{busy === "draft" ? "Saving…" : "Save as draft"}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: { padding: space.lg, gap: space.sm, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: { width: "31%", aspectRatio: 1, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.muted },
  addTile: { alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 2, borderStyle: "dashed", borderColor: colors.borderStrong, backgroundColor: colors.card },
  bar: { position: "absolute", left: 6, right: 6, bottom: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(0,0,0,0.4)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, backgroundColor: "#ffffff" },
  done: { position: "absolute", left: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.visit },
  failed: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.55)" },
  failedText: { fontFamily: fonts.bold, fontSize: 12, color: "#ffffff" },
  remove: { position: "absolute", right: 4, top: 4, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" },
  choice: { flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.card },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  choiceText: { fontFamily: fonts.bold, fontSize: 16, color: colors.foreground },
  choiceTextOn: { color: colors.brand },
  more: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  chipText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.foreground },
  draftLink: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  draftText: { fontFamily: fonts.bold, fontSize: 15, color: colors.brand },
});
