import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, Circle, MessageCircle, Phone, Receipt, ShieldCheck, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { Alert, Linking, ScrollView, Share, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, FormError } from "@/components/Form";
import { PickupCard } from "@/components/market/PickupCard";
import { StackHeader } from "@/components/StackHeader";
import { ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api, ApiError } from "@/lib/api";
import { cedis, shortDate } from "@/lib/format";
import type { Order } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

/** The steps an order goes through, as the buyer sees them. */
function steps(order: Order) {
  const made = order.plan === "deposit";
  return [
    { key: "paid", label: order.plan === "full" ? "Paid" : "Deposit paid", done: order.status === "paid", at: order.paid_at },
    ...(made ? [{ key: "ready", label: "Ready", done: Boolean(order.ready_at), at: order.ready_at ?? null }] : []),
    {
      key: "handed",
      label: order.fulfilment === "delivery" ? "Delivered" : "Handed over",
      done: ["delivered", "received"].includes(order.stage),
      at: order.delivered_at ?? null,
    },
    { key: "received", label: "You have it", done: order.stage === "received", at: order.received_at ?? null },
  ];
}

/**
 * One order: where it is (paid, ready, handed over, received), "I've got
 * it" and "Something's wrong", the workshop to collect from, the receipt,
 * and the seller's number once paid.
 */
export default function OrderScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const order = useQuery({ queryKey: ["order", reference], queryFn: () => api.order(reference) });
  const [reporting, setReporting] = useState(false);
  const [problem, setProblem] = useState("");
  const done = (updated: Order) => {
    client.setQueryData(["order", reference], updated);
    void client.invalidateQueries({ queryKey: ["orders"] });
  };
  const received = useMutation({ mutationFn: () => api.received(reference), onSuccess: done });
  const report = useMutation({
    mutationFn: () => api.reportProblem(reference, problem.trim()),
    onSuccess: (updated) => {
      done(updated);
      setReporting(false);
    },
  });
  const failure = received.error ?? report.error;

  if (order.isError) {
    return (
      <View style={styles.screen}>
        <StackHeader title="Order" />
        <ErrorState message="This order did not load." onRetry={() => void order.refetch()} />
      </View>
    );
  }
  const data = order.data;

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow={`ORDER ${reference}`} title={data?.seller_name ?? "Order"} />
      {!data ? (
        <View style={{ padding: space.lg }}>
          <Skeleton style={{ height: 300 }} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}>
          <View style={styles.card}>
            {steps(data).map((step, index, all) => (
              <View key={step.key} style={styles.step}>
                <View style={{ alignItems: "center" }}>
                  {step.done ? (
                    <CheckCircle2 size={22} color={colors.visit} />
                  ) : (
                    <Circle size={22} color={colors.borderStrong} />
                  )}
                  {index < all.length - 1 ? (
                    <View style={[styles.line, step.done ? { backgroundColor: colors.visit } : null]} />
                  ) : null}
                </View>
                <View style={{ flex: 1, paddingBottom: space.md }}>
                  <Text style={[styles.stepLabel, step.done ? null : { color: colors.mutedForeground }]}>{step.label}</Text>
                  {step.at ? <Text variant="small">{shortDate(step.at)}</Text> : null}
                </View>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            {data.items.map((item, index) => (
              <Text key={index}>
                {item.quantity} × {item.product_name}
                {item.option_label ? ` (${item.option_label})` : ""}
              </Text>
            ))}
            <Text style={styles.total}>{cedis(data.amount)}</Text>
            {data.plan === "collect" ? (
              <Text variant="small">
                Paid {cedis(data.deposit)} to hold it; {cedis(data.balance)} in cash when you collect.
              </Text>
            ) : null}
            {data.plan === "deposit" && data.balance_status !== "paid" ? (
              <Text variant="small">Deposit paid. {cedis(data.balance)} is due when it is ready.</Text>
            ) : null}
          </View>

          {data.protected ? (
            <View style={[styles.note, { backgroundColor: colors.visitBg }]}>
              <ShieldCheck size={18} color={colors.visit} />
              <Text variant="small" style={{ flex: 1, color: colors.visit }}>
                Protected: the seller is paid when you confirm you have it, or a few days after handover with no problem.
              </Text>
            </View>
          ) : null}

          {data.pickup ? <PickupCard pickup={data.pickup} /> : null}

          {data.stage === "problem" ? (
            <View style={[styles.note, { backgroundColor: colors.warnBg, flexDirection: "column", alignItems: "stretch" }]}>
              <Text variant="label" style={{ color: colors.warn }}>
                You reported a problem
              </Text>
              <Text variant="small">{data.problem}</Text>
              {data.problem_reply ? (
                <View style={styles.reply}>
                  <Text variant="label">The seller replied</Text>
                  <Text variant="small">{data.problem_reply}</Text>
                </View>
              ) : null}
              <Text variant="small">
                Fliiptech staff will look at both sides and decide: release the money to the seller or refund you.
              </Text>
            </View>
          ) : data.status === "paid" && data.stage !== "received" && data.stage !== "refunded" ? (
            <View style={{ gap: space.sm }}>
              <Button
                label="I've got it"
                busy={received.isPending}
                icon={<CheckCircle2 size={18} color="#ffffff" />}
                onPress={() =>
                  Alert.alert("Got it?", "Only confirm once you have it and it is as described.", [
                    { text: "Not yet", style: "cancel" },
                    { text: "Yes, I have it", onPress: () => received.mutate() },
                  ])
                }
              />
              {reporting ? (
                <View style={{ gap: space.sm }}>
                  <TextInput
                    value={problem}
                    onChangeText={setProblem}
                    placeholder="What went wrong?"
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    maxLength={1000}
                    style={styles.input}
                  />
                  <Button
                    label="Report the problem"
                    tone="outline"
                    busy={report.isPending}
                    disabled={!problem.trim()}
                    onPress={() => report.mutate()}
                  />
                </View>
              ) : (
                <Button
                  label="Something's wrong"
                  tone="soft"
                  icon={<TriangleAlert size={18} color={colors.brand} />}
                  onPress={() => setReporting(true)}
                />
              )}
            </View>
          ) : data.stage === "received" ? (
            <Text style={{ color: colors.visit, fontFamily: fonts.semibold }}>Thank you. The seller has been told.</Text>
          ) : null}
          <FormError message={failure instanceof ApiError ? failure.message : failure ? "That did not work." : null} />

          {data.seller_id ? (
            // Beside the call, for what a call is bad at: an address, a photo
            // of the colour, a time that suits.
            <Button
              label="Message the seller"
              icon={<MessageCircle size={16} color="#ffffff" />}
              onPress={() =>
                router.push({
                  pathname: "/chats/new",
                  params: {
                    seller: String(data.seller_id),
                    name: data.seller_name,
                    ...(data.items[0]?.product ? { product: String(data.items[0].product) } : {}),
                  },
                })
              }
            />
          ) : null}
          <View style={{ flexDirection: "row", gap: space.md }}>
            {data.seller_phone ? (
              <Button
                label="Call seller"
                tone="outline"
                icon={<Phone size={16} color={colors.brand} />}
                onPress={() => void Linking.openURL(`tel:${data.seller_phone}`)}
                style={{ flex: 1 }}
              />
            ) : null}
            {data.status === "paid" ? (
              <Button
                label="Receipt"
                tone="outline"
                icon={<Receipt size={16} color={colors.brand} />}
                onPress={() => void shareReceipt(data)}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: {
    gap: 4,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  step: { flexDirection: "row", gap: space.md },
  line: { width: 2, flex: 1, minHeight: 16, marginVertical: 2, backgroundColor: colors.border },
  stepLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.foreground },
  total: { marginTop: space.sm, fontFamily: fonts.extrabold, fontSize: 20, color: colors.brandDeep },
  note: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.lg },
  reply: { gap: 2, padding: space.sm, borderRadius: radius.md, backgroundColor: colors.card },
  input: {
    minHeight: 80,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.foreground,
    textAlignVertical: "top",
  },
});

/** The receipt as text, to keep or send on (WhatsApp, SMS, email): made on
    the phone, so it works offline from the saved order. */
function shareReceipt(order: Order) {
  const lines = [
    `Fliiptech receipt: order ${order.reference}`,
    order.paid_at ? `Paid ${shortDate(order.paid_at)}` : "",
    `Seller: ${order.seller_name}${order.seller_phone ? ` (${order.seller_phone})` : ""}`,
    "",
    ...order.items.map((item) => `${item.quantity} x ${item.product_name}${item.option_label ? ` (${item.option_label})` : ""}  ${cedis(item.unit_price)}`),
    Number(order.delivery) ? `Delivery  ${cedis(order.delivery)}` : "",
    Number(order.discount) ? `Discount  -${cedis(order.discount)}` : "",
    `Total  ${cedis(order.amount)}`,
    order.plan === "deposit" ? `Deposit paid; balance ${cedis(order.balance)}` : "",
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
  return Share.share({ title: `Receipt ${order.reference}`, message: lines.join("\n") });
}
