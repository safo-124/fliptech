import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CircleCheckBig, MessageCircle, X } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { requestNotificationAsk } from "@/components/NotificationAsk";
import { Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cedis, shortDate } from "@/lib/format";
import { showPhone } from "@/lib/phone";
import type { EnquiryConfirmation } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

/**
 * Ask a workshop about a course. Sent from the signed-in phone, so no code
 * to type: the backend trusts the number the account proved. The workshop
 * gets it in a chat (marketplace/chat.py on the server) and replies there,
 * and the person's number stays theirs until they share it.
 */
export default function EnquireScreen() {
  const params = useLocalSearchParams<{ area: string; slug: string; programme?: string }>();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const workshop = useQuery({
    queryKey: ["workshop", params.area, params.slug],
    queryFn: () => api.workshop(params.area, params.slug),
  });
  const [programmeId, setProgrammeId] = useState<number | null>(params.programme ? Number(params.programme) : null);
  const [intakeId, setIntakeId] = useState<number | null>(null);
  const [name, setName] = useState(auth.account?.display_name ?? "");
  const [message, setMessage] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();

  const send = useMutation({
    mutationFn: () =>
      api.enquire({
        phone: auth.account!.phone,
        programme_id: chosen!.id,
        intake_id: intakeId,
        trainee_name: name.trim(),
        message: message.trim(),
      }),
    // They are waiting for a workshop's answer now: the moment to offer
    // notifications, once.
    onSuccess: () => requestNotificationAsk(),
  });

  const programmes = workshop.data?.programmes ?? [];
  const chosen = programmes.find((p) => p.id === programmeId) ?? programmes[0];
  const intakes = chosen?.intakes.filter((i) => i.is_open) ?? [];

  function submit() {
    if (name.trim().length < 2) {
      setNameError("Tell the workshop your name.");
      return;
    }
    setNameError(undefined);
    send.mutate();
  }

  if (send.data) {
    return <Sent confirmation={send.data} bottom={insets.bottom} />;
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
          <X size={22} color={colors.foreground} />
        </Pressable>
        <Text variant="eyebrow" style={{ marginTop: space.lg }}>
          ENQUIRE
        </Text>
        <Text variant="display" style={{ marginTop: 4 }}>
          {workshop.data?.name ?? " "}
        </Text>
        <Text variant="small" style={{ marginTop: 4 }}>
          Free, and no commitment. The workshop replies within about two days.
        </Text>

        {workshop.isPending ? (
          <Skeleton style={{ height: 200, marginTop: space.xl }} />
        ) : (
          <View style={styles.form}>
            {programmes.length > 1 ? (
              <View style={{ gap: space.sm }}>
                <Text variant="label">Which course?</Text>
                {programmes.map((programme) => (
                  <Choice
                    key={programme.id}
                    active={programme.id === chosen?.id}
                    title={programme.title}
                    detail={`${cedis(programme.fee)} · ${programme.duration_weeks} weeks`}
                    onPress={() => {
                      setProgrammeId(programme.id);
                      setIntakeId(null);
                    }}
                  />
                ))}
              </View>
            ) : chosen ? (
              <View style={styles.summary}>
                <Text variant="heading">{chosen.title}</Text>
                <Text variant="small">
                  {cedis(chosen.fee)} · {chosen.duration_weeks} weeks
                </Text>
              </View>
            ) : null}

            {intakes.length ? (
              <View style={{ gap: space.sm }}>
                <Text variant="label">When would you start?</Text>
                <View style={styles.chips}>
                  {intakes.map((intake) => (
                    <Pressable
                      key={intake.id}
                      onPress={() => setIntakeId(intake.id === intakeId ? null : intake.id)}
                      style={[styles.chip, intake.id === intakeId ? styles.chipOn : null]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: intake.id === intakeId }}
                    >
                      <Text style={[styles.chipText, intake.id === intakeId ? styles.chipTextOn : null]}>
                        {shortDate(intake.start_date)}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setIntakeId(null)}
                    style={[styles.chip, intakeId === null ? styles.chipOn : null]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.chipText, intakeId === null ? styles.chipTextOn : null]}>Not sure yet</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <Field
              label="Your name"
              value={name}
              onChangeText={setName}
              placeholder="Ama Owusu"
              autoComplete="name"
              maxLength={120}
              error={nameError}
            />
            <Field
              label="Anything to ask? (optional)"
              value={message}
              onChangeText={setMessage}
              placeholder="For example: can I pay in instalments? Do I need my own tools?"
              multiline
              maxLength={1000}
            />

            {auth.signedIn && auth.account ? (
              <Text variant="small">
                They will reply to <Text style={styles.strong}>{showPhone(auth.account.phone)}</Text>.
              </Text>
            ) : null}
            <FormError message={send.error instanceof ApiError ? send.error.message : send.error ? "That did not send. Try again." : null} />
            {auth.signedIn ? (
              <Button label="Send enquiry" onPress={submit} busy={send.isPending} disabled={!chosen} />
            ) : (
              <Button
                label="Sign in to send"
                onPress={() => router.push({ pathname: "/sign-in", params: { why: "to send your enquiry" } })}
              />
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Choice({
  active,
  title,
  detail,
  onPress,
}: {
  active: boolean;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      style={[styles.choice, active ? styles.choiceOn : null]}
    >
      <View style={[styles.radio, active ? styles.radioOn : null]}>{active ? <View style={styles.radioDot} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text variant="label">{title}</Text>
        <Text variant="small">{detail}</Text>
      </View>
    </Pressable>
  );
}

function Sent({ confirmation, bottom }: { confirmation: EnquiryConfirmation; bottom: number }) {
  return (
    <View style={[styles.screen, styles.sent, { paddingBottom: bottom + space.xl }]}>
      <View style={styles.doneIcon}>
        <CircleCheckBig size={44} color={colors.visit} />
      </View>
      <Text variant="display" style={{ textAlign: "center" }}>
        Enquiry sent
      </Text>
      <Text style={styles.sentBody}>
        {confirmation.conversation_id
          ? `${confirmation.provider_name} replies here in your messages, usually within ${confirmation.expect_reply_within_hours ?? 48} hours. Your number stays hidden unless you share it.`
          : `${confirmation.provider_name} will reply within about ${confirmation.expect_reply_within_hours ?? 48} hours.`}
      </Text>
      <View style={styles.reference}>
        <Text variant="small">Your reference</Text>
        <Text style={styles.referenceCode}>{confirmation.reference_code}</Text>
      </View>
      <View style={{ alignSelf: "stretch", gap: space.md }}>
        {confirmation.conversation_id ? (
          <Button
            label="Open the chat"
            icon={<MessageCircle size={18} color="#ffffff" />}
            onPress={() =>
              router.replace({ pathname: "/chats/[id]", params: { id: String(confirmation.conversation_id) } })
            }
          />
        ) : confirmation.whatsapp_url ? (
          <Button
            label="Message them on WhatsApp"
            icon={<MessageCircle size={18} color="#ffffff" />}
            onPress={() => void Linking.openURL(confirmation.whatsapp_url!)}
          />
        ) : null}
        <Button label="Done" tone="soft" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.muted,
  },
  form: { marginTop: space.xl, gap: space.xl },
  summary: { padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.brandSoft, gap: 2 },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 42,
    paddingHorizontal: space.lg,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.foreground },
  chipTextOn: { color: "#ffffff" },
  strong: { fontFamily: fonts.bold, color: colors.foreground },
  sent: { alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg },
  doneIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.visitBg,
  },
  sentBody: { textAlign: "center", color: colors.mutedForeground, fontSize: 15, lineHeight: 22 },
  reference: {
    alignItems: "center",
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  referenceCode: { fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: 2, color: colors.brandDeep },
});
