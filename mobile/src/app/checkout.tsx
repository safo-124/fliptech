import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { BadgeCheck, CloudOff, Handshake, ShieldCheck, Star, Store, Truck } from "lucide-react-native";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { BasketLineRow } from "@/components/market/BasketLineRow";
import { Row, Way } from "@/components/market/Choice";
import { PhoneProofFields, usePhoneProof } from "@/components/market/PhoneProof";
import { PickupCard } from "@/components/market/PickupCard";
import { StackHeader } from "@/components/StackHeader";
import { Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { groupFor, useBasket } from "@/lib/basket";
import { SITE_URL } from "@/lib/config";
import { cedis } from "@/lib/format";
import { useOnline } from "@/lib/online";
import { payOnPaystack } from "@/lib/pay";
import { colors, fonts, radius, space } from "@/theme/tokens";

/**
 * Checking out one seller's part of the basket, on one screen: the lines
 * (still adjustable), phone (a code typed here when it is not the signed-in
 * buyer's own number; the code fills itself in from the SMS where the phone
 * offers it, and checking it signs them in and merges their basket), name,
 * Collect or Delivery, the summary, who they are paying, and one button.
 *
 * A seller who takes payments: "Pay GH₵X with MoMo or card" opens Paystack
 * in the app's browser sheet (lib/pay.ts); the lines stay in the basket
 * until the payment is confirmed. One who does not: "Send order to <seller>"
 * sends it to them to be paid directly. Either way the order's screen comes
 * next. Every total is the server's.
 */
export default function CheckoutScreen() {
  const { seller: sellerParam, way } = useLocalSearchParams<{ seller?: string; way?: string }>();
  const sellerId = Number(sellerParam);
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const basket = useBasket();
  const online = useOnline();
  const proof = usePhoneProof();
  const group = groupFor(basket.basket, sellerId);
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">(way === "delivery" ? "delivery" : "pickup");
  const [name, setName] = useState(auth.account?.display_name ?? "");
  const [note, setNote] = useState(auth.account?.delivery_address ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const handover = group?.delivery ? fulfilment : "pickup";
  const pays = Boolean(group?.takes_payments);
  const items = (group?.lines ?? [])
    .filter((line) => line.available)
    .map((line) => ({ product: line.product, option: line.option, quantity: line.quantity }));
  // A seller paid on the site: the exact sum to be charged, from the same
  // server function checkout uses (student prices, deposits).
  const price = useQuery({
    queryKey: ["bag-price", sellerId, items, handover],
    queryFn: () => api.priceBag(sellerId, { items, fulfilment: handover }),
    enabled: pays && items.length > 0 && online,
    retry: false,
  });

  async function submit() {
    if (!group) return;
    const wrong: Record<string, string> = {};
    if (name.trim().length < 2) wrong.name = "The seller needs a name for the order.";
    if (handover === "delivery" && !note.trim()) wrong.note = "Say where it should be delivered.";
    setFields(wrong);
    if (Object.keys(wrong).length) return;
    setProblem(null);
    setBusy(true);
    try {
      const phone = await proof.prove(name);
      if (!phone) return;
      const result = await basket.checkout(sellerId, {
        phone,
        name: name.trim(),
        fulfilment: handover,
        note: note.trim() || undefined,
      });
      if (result.kind === "direct") {
        router.replace({ pathname: "/order/[reference]", params: { reference: result.reference } });
        return;
      }
      await payOnPaystack(result.authorization_url);
      const order = await api.confirmOrder(result.reference);
      void basket.refresh();
      if (order.status === "paid") {
        router.replace({ pathname: "/order/[reference]", params: { reference: order.reference } });
      } else {
        Alert.alert(
          "Not paid yet",
          "The payment did not go through, or it is still on its way. Your basket is just as you left it: try again when you are ready.",
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

  if (!group || !items.length) {
    return (
      <View style={styles.screen}>
        <StackHeader title="Checkout" />
        {basket.loading ? (
          <View style={{ padding: space.lg }}>
            <Skeleton style={{ height: 200 }} />
          </View>
        ) : (
          <View style={{ padding: space.lg, gap: space.md }}>
            <Text>Nothing from this seller is in your basket.</Text>
            <Button label="View basket" tone="outline" onPress={() => router.replace("/basket")} />
          </View>
        )}
      </View>
    );
  }

  const seller = group.seller;
  const priced = price.data;
  const direct = group.totals[handover];
  const amount = priced ? cedis(priced.plan === "full" ? priced.total : priced.pay_now) : "";
  const label = !pays
    ? proof.waiting
      ? "Check the code and send the order"
      : `Send order to ${seller.business_name}`
    : proof.waiting
      ? `Check the code and pay ${amount}`
      : priced && priced.plan !== "full"
        ? `Pay deposit ${amount} with MoMo or card`
        : `Pay ${amount} with MoMo or card`;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StackHeader eyebrow="CHECKOUT" title={seller.business_name} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: insets.bottom + 140 }}
        keyboardShouldPersistTaps="handled"
      >
        {!online ? (
          <View style={styles.offline} accessibilityLiveRegion="polite">
            <CloudOff size={16} color={colors.warn} />
            <Text style={styles.offlineText}>You&apos;re offline</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          {group.lines.map((line) => (
            <BasketLineRow key={line.id} line={line} offline={!online} />
          ))}
        </View>

        <PhoneProofFields proof={proof} />
        <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" maxLength={120} error={fields.name} />

        <View style={{ gap: space.sm }}>
          <Text variant="label">How do you want it?</Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Way
              active={handover === "pickup"}
              onPress={() => setFulfilment("pickup")}
              icon={<Store size={18} color={colors.brand} />}
              title="Collect"
            />
            {group.delivery ? (
              <Way
                active={handover === "delivery"}
                onPress={() => setFulfilment("delivery")}
                icon={<Truck size={18} color={colors.brand} />}
                title="Delivery"
                detail={`${cedis(group.delivery.fee)} delivery`}
              />
            ) : null}
          </View>
          {handover === "pickup" ? (
            group.pickup ? (
              <PickupCard pickup={group.pickup} />
            ) : (
              <Text variant="small">{seller.business_name} tells you where to collect it.</Text>
            )
          ) : null}
        </View>

        <Field
          label={handover === "delivery" ? "Where to deliver" : "A note for the maker (optional)"}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={500}
          placeholder={handover === "delivery" ? "House number, street, a landmark" : "Anything they should know"}
          error={fields.note}
        />

        <View style={styles.summary}>
          {pays ? (
            price.isPending && online ? (
              <Skeleton style={{ height: 90 }} />
            ) : priced ? (
              <>
                {priced.lines.map((line) => (
                  <Row
                    key={`${line.product}-${line.option}`}
                    label={`${line.quantity} × ${line.product_name}${line.option_label ? ` (${line.option_label})` : ""}`}
                    value={cedis(line.total)}
                  />
                ))}
                {Number(priced.discount) > 0 ? <Row label="Student price" value={`−${cedis(priced.discount)}`} /> : null}
                {handover === "delivery" ? <Row label="Delivery" value={cedis(priced.delivery)} /> : null}
                <Row label="Total" value={cedis(priced.total)} strong />
                {priced.plan === "deposit" ? (
                  <Text variant="small">
                    Pay deposit {cedis(priced.pay_now)} now, {cedis(priced.balance)} when ready.
                  </Text>
                ) : null}
              </>
            ) : (
              <FormError message={price.error instanceof ApiError ? price.error.message : group.problem || null} />
            )
          ) : direct ? (
            <>
              <Row label="Subtotal" value={cedis(direct.subtotal)} />
              {handover === "delivery" ? <Row label="Delivery" value={cedis(direct.delivery)} /> : null}
              <Row label="Total" value={cedis(direct.total)} strong />
            </>
          ) : null}
        </View>

        <View style={styles.trust}>
          <Text variant="label">You are paying {seller.business_name}</Text>
          <View style={styles.badges}>
            {seller.area ? <Text variant="small">{seller.area}</Text> : null}
            {seller.verified ? (
              <View style={styles.badge}>
                <BadgeCheck size={14} color={colors.visit} />
                <Text style={styles.badgeText}>Checked by Fliiptech</Text>
              </View>
            ) : null}
            {seller.rating ? (
              <View style={styles.badge}>
                <Star size={14} color={colors.warn} />
                <Text style={styles.badgeText}>
                  {seller.rating.average.toFixed(1)} ({seller.rating.count})
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <ShieldCheck size={18} color={colors.visit} />
            <View style={{ flex: 1, gap: 2 }}>
              {pays ? (
                <>
                  <Text variant="label">What if it doesn&apos;t arrive?</Text>
                  <Text variant="small">
                    Fliiptech holds your money until you have it. If it does not arrive, or is not as described, tell
                    us and you get it back.
                  </Text>
                  <Pressable
                    onPress={() => void Linking.openURL(`${SITE_URL}/marketplace/terms#refunds`)}
                    accessibilityRole="link"
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <Text style={styles.link}>How refunds work</Text>
                  </Pressable>
                </>
              ) : (
                <Text variant="small">
                  You pay {seller.business_name} directly, so Fliiptech cannot refund it. Agree the price and the
                  handover in the chat before you pay.
                </Text>
              )}
            </View>
          </View>
        </View>

        {pays ? null : (
          <View style={styles.direct}>
            <Handshake size={18} color={colors.warn} />
            <Text variant="small" style={{ flex: 1 }}>
              This maker takes payment directly. We send them your order and you agree payment and pickup in the chat.
            </Text>
          </View>
        )}
        <FormError message={problem} />
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: insets.bottom + space.md }]}>
        <Button
          label={label}
          busy={busy}
          disabled={!online || (pays ? !priced : !direct)}
          onPress={() => void submit()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  offline: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.warnBg },
  offlineText: { fontFamily: fonts.semibold, color: colors.warn },
  card: {
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  summary: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  trust: { gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.visitBg },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  badgeText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.foreground },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand, textDecorationLine: "underline" },
  direct: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.warnBg },
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
