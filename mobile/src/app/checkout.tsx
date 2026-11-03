import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Bike, ShieldCheck, Store } from "lucide-react-native";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api, ApiError, type BagRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bySeller, useBag } from "@/lib/bag";
import { cedis } from "@/lib/format";
import { payOnPaystack } from "@/lib/pay";
import { showPhone } from "@/lib/phone";
import { colors, fonts, radius, space } from "@/theme/tokens";

/**
 * Pay one seller for their part of the bag. The total is the server's, not
 * the phone's sum: delivery, codes and deposits are worked out there.
 */
export default function CheckoutScreen() {
  const { seller: sellerParam } = useLocalSearchParams<{ seller: string }>();
  const sellerId = Number(sellerParam);
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const bag = useBag();
  const client = useQueryClient();
  const group = bySeller(bag.items).find((row) => row.seller.id === sellerId);
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">("pickup");
  const [name, setName] = useState(auth.account?.display_name ?? "");
  const [note, setNote] = useState(auth.account?.delivery_address ?? "");
  const [typedCode, setTypedCode] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const request: BagRequest = {
    items: (group?.items ?? []).map((row) => ({ product: row.product, option: row.option, quantity: row.quantity })),
    fulfilment,
    ...(code ? { code } : {}),
  };
  const price = useQuery({
    queryKey: ["bag-price", sellerId, request],
    queryFn: () => api.priceBag(sellerId, request),
    enabled: Boolean(group),
    retry: false,
  });

  async function pay() {
    if (!auth.signedIn || !auth.account) {
      router.push({ pathname: "/sign-in", params: { why: "to pay" } });
      return;
    }
    const wrong: Record<string, string> = {};
    if (name.trim().length < 2) wrong.name = "The seller needs a name to hand it over to.";
    if (fulfilment === "delivery" && !note.trim()) wrong.note = "Say where it should be delivered.";
    setFields(wrong);
    if (Object.keys(wrong).length) return;
    setProblem(null);
    setBusy(true);
    try {
      const started = await api.checkout(sellerId, {
        ...request,
        phone: auth.account.phone,
        name: name.trim(),
        note: note.trim(),
      });
      await payOnPaystack(started.authorization_url);
      const order = await api.confirmOrder(started.reference);
      if (order.status === "paid") {
        bag.clearSeller(sellerId);
        void client.invalidateQueries({ queryKey: ["orders"] });
        router.replace({ pathname: "/orders", params: { paid: order.reference } });
      } else {
        Alert.alert(
          "Not paid yet",
          "Nothing was taken, or it is still on its way. If money left your account, the order shows in My orders within a few minutes.",
        );
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setFields(error.fields);
        setProblem(error.message);
      } else {
        setProblem("That did not work. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!group) {
    return (
      <View style={styles.screen}>
        <StackHeader title="Checkout" />
        <Text variant="small" style={{ padding: space.lg }}>
          Nothing from this seller is in your bag.
        </Text>
      </View>
    );
  }

  const priced = price.data;
  const priceError = price.error instanceof ApiError ? price.error.message : price.error ? "The total did not load." : null;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StackHeader eyebrow="CHECKOUT" title={group.seller.business_name} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: insets.bottom + 140 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space.sm }}>
          <Text variant="label">How do you want it?</Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Way
              active={fulfilment === "pickup"}
              icon={<Store size={20} color={fulfilment === "pickup" ? colors.brand : colors.mutedForeground} />}
              title="Pick it up"
              detail="Free"
              onPress={() => setFulfilment("pickup")}
            />
            <Way
              active={fulfilment === "delivery"}
              icon={<Bike size={20} color={fulfilment === "delivery" ? colors.brand : colors.mutedForeground} />}
              title="Deliver it"
              detail={priced?.delivery_fee ? cedis(priced.delivery_fee) : "Ask"}
              onPress={() => setFulfilment("delivery")}
            />
          </View>
          {fulfilment === "delivery" && priced?.delivery_area ? (
            <Text variant="small">Delivers to: {priced.delivery_area}</Text>
          ) : null}
        </View>

        <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" maxLength={120} error={fields.name} />
        <Field
          label={fulfilment === "delivery" ? "Where to deliver" : "A note for the seller (optional)"}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={500}
          placeholder={fulfilment === "delivery" ? "House number, street, a landmark" : "Anything they should know"}
          error={fields.note}
        />
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Discount code (optional)"
              value={typedCode}
              onChangeText={setTypedCode}
              autoCapitalize="characters"
              maxLength={30}
              error={code && priceError ? priceError : fields.code}
            />
          </View>
          <Button label="Apply" tone="soft" onPress={() => setCode(typedCode.trim())} style={{ minHeight: 50 }} />
        </View>

        <View style={styles.summary}>
          {price.isPending ? (
            <Skeleton style={{ height: 120 }} />
          ) : priced ? (
            <>
              {priced.lines.map((line) => (
                <Row
                  key={`${line.product}-${line.option}`}
                  label={`${line.quantity} × ${line.product_name}${line.option_label ? ` (${line.option_label})` : ""}`}
                  value={cedis(line.total)}
                />
              ))}
              {Number(priced.discount) > 0 ? <Row label={`Code ${priced.code}`} value={`−${cedis(priced.discount)}`} /> : null}
              {fulfilment === "delivery" ? <Row label="Delivery" value={cedis(priced.delivery)} /> : null}
              <View style={styles.divider} />
              <Row label="Total" value={cedis(priced.total)} strong />
              {priced.plan === "deposit" ? (
                <Text variant="small">
                  Made to order: pay {cedis(priced.pay_now)} now ({priced.deposit_percent}% deposit) and{" "}
                  {cedis(priced.balance)} when it is ready.
                </Text>
              ) : null}
            </>
          ) : (
            <FormError message={priceError} />
          )}
        </View>

        <View style={styles.protect}>
          <ShieldCheck size={20} color={colors.visit} />
          <Text variant="small" style={{ flex: 1 }}>
            {auth.account ? `The seller will call ${showPhone(auth.account.phone)} to hand it over. ` : ""}
            Pay with MoMo or card on Paystack; it comes back here when done.
          </Text>
        </View>
        <FormError message={problem} />
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: insets.bottom + space.md }]}>
        <Button
          label={
            !auth.signedIn
              ? "Sign in to pay"
              : priced
                ? `Pay ${cedis(priced.pay_now)}`
                : "Pay"
          }
          busy={busy}
          disabled={auth.signedIn && !priced}
          onPress={() => void pay()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function Way({
  active,
  icon,
  title,
  detail,
  onPress,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      style={[styles.way, active ? styles.wayOn : null]}
    >
      {icon}
      <Text variant="label">{title}</Text>
      <Text variant="small">{detail}</Text>
    </Pressable>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[{ flex: 1 }, strong ? styles.strong : styles.rowLabel]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={strong ? styles.strongValue : styles.rowValue}>{value}</Text>
    </View>
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
  summary: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", gap: space.md, alignItems: "baseline" },
  rowLabel: { color: colors.mutedForeground, fontSize: 14 },
  rowValue: { fontFamily: fonts.semibold, fontSize: 14, color: colors.foreground },
  strong: { fontFamily: fonts.bold, fontSize: 16, color: colors.foreground },
  strongValue: { fontFamily: fonts.extrabold, fontSize: 20, color: colors.brandDeep },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 },
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
