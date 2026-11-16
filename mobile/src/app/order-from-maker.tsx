import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import {
  Bike,
  CheckCircle2,
  Handshake,
  MessageCircle,
  Minus,
  Plus,
  Store,
} from "lucide-react-native";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import {
  PhoneProofFields,
  usePhoneProof,
} from "@/components/market/PhoneProof";
import { StackHeader } from "@/components/StackHeader";
import { ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MAX_QUANTITY } from "@/lib/bag";
import { cedis } from "@/lib/format";
import type { Order } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

/**
 * "Order from the maker", for a maker who cannot take payment on the site
 * yet. Phone (proved on this form), name, how many, Collect or Delivery and
 * a note: the order goes to the maker's Orders, marked "Pay the maker
 * directly", and into the chat, where the two of them agree payment and
 * pickup. Nothing is charged here. The same as the website's form.
 */
export default function OrderFromMakerScreen() {
  const params = useLocalSearchParams<{
    product: string;
    option?: string;
    quantity?: string;
  }>();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const client = useQueryClient();
  const product = useQuery({
    queryKey: ["product", params.product],
    queryFn: () => api.product(params.product),
  });
  const proof = usePhoneProof();
  const [optionId, setOptionId] = useState<number | null>(
    params.option ? Number(params.option) : null,
  );
  const [quantity, setQuantity] = useState(
    Math.max(1, Number(params.quantity) || 1),
  );
  const [name, setName] = useState(auth.account?.display_name ?? "");
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">("pickup");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<
    (Order & { conversation_id: number | null }) | null
  >(null);

  const data = product.data;
  if (product.isError) {
    return (
      <View style={styles.screen}>
        <StackHeader title="Order from the maker" />
        <ErrorState
          message="This product did not load."
          onRetry={() => void product.refetch()}
        />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.screen}>
        <StackHeader title="Order from the maker" />
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 60 }} />
          <Skeleton style={{ height: 200 }} />
        </View>
      </View>
    );
  }

  const options = data.options;
  const option = options.find((row) => row.id === optionId) ?? null;
  const needsOption = options.some((row) => row.available) && !option;
  const unit = option?.price ?? data.price;
  const most = Math.min(MAX_QUANTITY, data.few_left ?? MAX_QUANTITY);
  const delivers =
    data.seller.delivery_fee !== null && data.seller.delivery_fee !== undefined;
  const maker = data.seller.business_name;

  async function send() {
    if (!data) return;
    const wrong: Record<string, string> = {};
    if (needsOption) wrong.option = "Choose one first.";
    if (name.trim().length < 2)
      wrong.name = "The maker needs a name for the order.";
    if (fulfilment === "delivery" && !note.trim())
      wrong.note = "Say where it should be delivered.";
    setFields(wrong);
    if (Object.keys(wrong).length) return;
    setProblem(null);
    setBusy(true);
    try {
      const phone = await proof.prove(name);
      if (!phone) return;
      const order = await api.orderFromMaker(data.id, {
        phone,
        name: name.trim(),
        quantity,
        option: option?.id ?? null,
        fulfilment,
        note: note.trim() || undefined,
      });
      void client.invalidateQueries({ queryKey: ["orders"] });
      setSent(order);
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

  if (sent) {
    return (
      <View style={styles.screen}>
        <StackHeader eyebrow="ORDER SENT" title={maker} />
        <View style={{ padding: space.lg, gap: space.lg }}>
          <View style={styles.done}>
            <CheckCircle2 size={28} color={colors.visit} />
            <Text variant="title" style={{ color: colors.visit }}>
              Your order is with {maker}
            </Text>
            <Text>
              They will message or call you to agree payment and pickup. You pay{" "}
              {maker} directly: nothing was charged here.
            </Text>
          </View>
          {sent.conversation_id ? (
            <Button
              label="Message the maker"
              icon={<MessageCircle size={18} color="#fff" />}
              onPress={() =>
                router.replace({
                  pathname: "/chats/[id]",
                  params: { id: String(sent.conversation_id) },
                })
              }
            />
          ) : null}
          <Button
            label="See your order"
            tone="outline"
            onPress={() =>
              router.replace({
                pathname: "/order/[reference]",
                params: { reference: sent.reference },
              })
            }
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StackHeader eyebrow="ORDER FROM THE MAKER" title={data.name} />
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          gap: space.xl,
          paddingBottom: insets.bottom + 120,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.direct}>
          <Handshake size={20} color={colors.warn} />
          <Text variant="small" style={{ flex: 1 }}>
            This maker takes payment directly for now. Fliiptech passes your
            order to them and you agree payment and pickup in the chat.
          </Text>
        </View>

        {options.length ? (
          <View style={{ gap: space.sm }}>
            <Text variant="label">Choose one</Text>
            <View style={styles.chips}>
              {options.map((row) => (
                <Pressable
                  key={row.id}
                  disabled={!row.available}
                  onPress={() => setOptionId(row.id)}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: row.id === optionId,
                    disabled: !row.available,
                  }}
                  style={[
                    styles.chip,
                    row.id === optionId ? styles.chipOn : null,
                    !row.available ? { opacity: 0.4 } : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      row.id === optionId ? { color: "#fff" } : null,
                    ]}
                  >
                    {row.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {fields.option ? (
              <Text variant="small" style={{ color: colors.destructive }}>
                {fields.option}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.quantityRow}>
          <View>
            <Text variant="label">How many</Text>
            <Text variant="small">
              {unit ? `${cedis(unit)} each` : "Price agreed with the maker"}
            </Text>
            {data.few_left ? (
              <Text style={styles.left}>Only {data.few_left} left</Text>
            ) : null}
          </View>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => setQuantity((n) => Math.max(1, n - 1))}
              style={styles.step}
              accessibilityRole="button"
              accessibilityLabel="One fewer"
            >
              <Minus size={18} color={colors.foreground} />
            </Pressable>
            <Text style={styles.count}>{quantity}</Text>
            <Pressable
              onPress={() => setQuantity((n) => Math.min(most, n + 1))}
              disabled={quantity >= most}
              style={[styles.step, quantity >= most ? { opacity: 0.35 } : null]}
              accessibilityRole="button"
              accessibilityLabel="One more"
            >
              <Plus size={18} color={colors.foreground} />
            </Pressable>
          </View>
        </View>

        <PhoneProofFields proof={proof} />
        <Field
          label="Your name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          maxLength={120}
          error={fields.name}
        />

        <View style={{ gap: space.sm }}>
          <Text variant="label">How do you want it?</Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Pressable
              onPress={() => setFulfilment("pickup")}
              accessibilityRole="radio"
              accessibilityState={{ checked: fulfilment === "pickup" }}
              style={[
                styles.way,
                fulfilment === "pickup" ? styles.wayOn : null,
              ]}
            >
              <Store
                size={20}
                color={
                  fulfilment === "pickup"
                    ? colors.brand
                    : colors.mutedForeground
                }
              />
              <Text variant="label">Collect</Text>
            </Pressable>
            {delivers ? (
              <Pressable
                onPress={() => setFulfilment("delivery")}
                accessibilityRole="radio"
                accessibilityState={{ checked: fulfilment === "delivery" }}
                style={[
                  styles.way,
                  fulfilment === "delivery" ? styles.wayOn : null,
                ]}
              >
                <Bike
                  size={20}
                  color={
                    fulfilment === "delivery"
                      ? colors.brand
                      : colors.mutedForeground
                  }
                />
                <Text variant="label">Delivery</Text>
                <Text variant="small">
                  {cedis(data.seller.delivery_fee ?? "0")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <Field
          label={
            fulfilment === "delivery"
              ? "Where to deliver"
              : "A note for the maker (optional)"
          }
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={500}
          placeholder={
            fulfilment === "delivery"
              ? "House number, street, a landmark"
              : "Anything they should know"
          }
          error={fields.note}
        />
        <FormError message={problem} />
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: insets.bottom + space.md }]}>
        <Button
          label={
            proof.waiting
              ? "Check the code and send the order"
              : "Send my order"
          }
          busy={busy}
          onPress={() => void send()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  direct: {
    flexDirection: "row",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.warnBg,
  },
  done: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.visitBg,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.foreground,
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  left: { color: colors.warn, fontFamily: fonts.bold, fontSize: 13 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  step: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  count: {
    minWidth: 28,
    textAlign: "center",
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.foreground,
  },
  way: {
    flex: 1,
    gap: 4,
    minHeight: 64,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  wayOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
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
