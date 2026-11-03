import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Bike, ShieldCheck, Store } from "lucide-react-native";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { BundleCard } from "@/components/market/BundleCard";
import { StackHeader } from "@/components/StackHeader";
import { ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cedis } from "@/lib/format";
import { payOnPaystack } from "@/lib/pay";
import { colors, radius, space } from "@/theme/tokens";

/**
 * Learn and buy: the course and the kit, paid once to the workshop. The
 * course opens on this phone when the payment arrives; the tools are
 * handed over like any order.
 */
export default function BundleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const client = useQueryClient();
  const bundle = useQuery({ queryKey: ["bundle", id], queryFn: () => api.bundle(id) });
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">("pickup");
  const [name, setName] = useState(auth.account?.display_name ?? "");
  const [note, setNote] = useState(auth.account?.delivery_address ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const data = bundle.data;
  const delivery = fulfilment === "delivery" && data?.delivery_fee ? Number(data.delivery_fee) : 0;
  const total = data ? Number(data.price ?? 0) + delivery : 0;

  async function pay() {
    if (!data) return;
    if (!auth.signedIn || !auth.account) {
      router.push({ pathname: "/sign-in", params: { why: "to buy this bundle" } });
      return;
    }
    if (name.trim().length < 2) {
      setProblem("Enter your name, so the workshop knows who to hand it to.");
      return;
    }
    if (fulfilment === "delivery" && !note.trim()) {
      setProblem("Say where it should be delivered.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const started = await api.buyBundle(data.id, {
        phone: auth.account.phone,
        name: name.trim(),
        fulfilment,
        note: note.trim() || undefined,
      });
      await payOnPaystack(started.authorization_url);
      const order = await api.confirmOrder(started.reference);
      if (order.status === "paid") {
        void client.invalidateQueries({ queryKey: ["my-courses"] });
        void client.invalidateQueries({ queryKey: ["orders"] });
        Alert.alert("Paid", data.course ? "Your course is open in My courses. The workshop will hand over the tools." : "The workshop will hand over your order.");
        router.replace({ pathname: "/orders", params: { paid: order.reference } });
      } else {
        Alert.alert("Not paid yet", "If money left your account, it shows in My orders within a few minutes.");
      }
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StackHeader eyebrow="LEARN AND BUY" title={data?.title ?? "Bundle"} />
      {bundle.isError ? (
        <ErrorState message="This bundle did not load." onRetry={() => void bundle.refetch()} />
      ) : !data ? (
        <View style={{ padding: space.lg }}>
          <Skeleton style={{ height: 240 }} />
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: insets.bottom + 120 }}
            keyboardShouldPersistTaps="handled"
          >
            <BundleCard bundle={data} onPress={() => undefined} />
            {data.blurb ? <Text style={{ color: colors.mutedForeground }}>{data.blurb}</Text> : null}

            <View style={{ gap: space.sm }}>
              <Text variant="label">How do you want the tools?</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Way
                  active={fulfilment === "pickup"}
                  icon={<Store size={20} color={fulfilment === "pickup" ? colors.brand : colors.mutedForeground} />}
                  title="Collect them"
                  detail="Free, at the workshop"
                  onPress={() => setFulfilment("pickup")}
                />
                <Way
                  active={fulfilment === "delivery"}
                  icon={<Bike size={20} color={fulfilment === "delivery" ? colors.brand : colors.mutedForeground} />}
                  title="Deliver them"
                  detail={data.delivery_fee !== null ? cedis(data.delivery_fee) : "Not offered"}
                  disabled={data.delivery_fee === null}
                  onPress={() => setFulfilment("delivery")}
                />
              </View>
            </View>
            <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" maxLength={120} />
            <Field
              label={fulfilment === "delivery" ? "Where to deliver" : "A note for the workshop (optional)"}
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={500}
            />
            <View style={styles.protect}>
              <ShieldCheck size={20} color={colors.visit} />
              <Text variant="small" style={{ flex: 1 }}>
                The course opens on your phone when you pay. Pay with MoMo or card on Paystack; it comes back here when
                done.
              </Text>
            </View>
            <FormError message={problem || (data.buy_online ? null : data.problem || "Not available right now.")} />
          </ScrollView>
          <View style={[styles.cta, { paddingBottom: insets.bottom + space.md }]}>
            <Button
              label={!auth.signedIn ? "Sign in to buy" : `Pay ${cedis(total)}`}
              busy={busy}
              disabled={auth.signedIn && !data.buy_online}
              onPress={() => void pay()}
            />
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function Way({
  active,
  icon,
  title,
  detail,
  onPress,
  disabled = false,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      style={[styles.way, active ? styles.wayOn : null, disabled ? { opacity: 0.45 } : null]}
    >
      {icon}
      <Text variant="label">{title}</Text>
      <Text variant="small">{detail}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  way: {
    flex: 1,
    gap: 4,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  wayOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  protect: { flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.visitBg },
  cta: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
