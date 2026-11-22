import { CircleCheck, X } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { Text } from "@/components/Text";
import { api, ApiError } from "@/lib/api";
import { colors, fonts, radius, space } from "@/theme/tokens";

/** Why a video is reported, as the server knows them. */
export const REPORT_REASONS = [
  { value: "not_theirs", label: "It is not their own video" },
  { value: "no_consent", label: "Someone in it did not agree to be filmed" },
  { value: "child", label: "A child appears without a guardian" },
  { value: "unsafe", label: "Unsafe use of chemicals, heat or tools" },
  { value: "offensive", label: "Sexual, violent or abusive" },
  { value: "advertising", label: "It only advertises, it does not teach" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

const NOTE_MAX = 500;

const T = {
  title: "Report this video",
  reasons: "What is wrong with it?",
  noteLabel: "Anything else our team should know (optional)",
  noteHint: `Up to ${NOTE_MAX} characters.`,
  send: "Send report",
  reasonRequired: "Choose what is wrong with this video.",
  thanks: "Thanks. Our team will look at it.",
  done: "Done",
  gone: "This video is no longer shown, so there is nothing to report.",
  tooMany: "You have sent too many reports for now. Try again later.",
  failed: "The report could not be sent. Check your connection and try again.",
};

/**
 * Reporting a lesson video to staff, on a sheet over the course: a reason,
 * an optional note, then thanks. Trainers' videos can go live before staff
 * have watched them, so this is how a bad one is found quickly.
 */
export function ReportVideoSheet({
  videoId,
  videoTitle,
  visible,
  onClose,
}: {
  videoId: number;
  videoTitle: string;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);

  // Each time it opens, a fresh report.
  function reset() {
    setReason(null);
    setNote("");
    setError(null);
    setNoteError(undefined);
    setSent(false);
  }

  async function send() {
    if (!reason) {
      setError(T.reasonRequired);
      return;
    }
    setSending(true);
    setError(null);
    setNoteError(undefined);
    try {
      await api.reportVideo(videoId, reason, note.trim());
      setSent(true);
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 429) setError(T.tooMany);
      else if (problem instanceof ApiError && problem.status === 404) setError(T.gone);
      else if (problem instanceof ApiError && problem.fields.note) setNoteError(problem.fields.note);
      else if (problem instanceof ApiError && problem.status >= 400 && problem.status < 500) setError(problem.message);
      else setError(T.failed);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} onShow={reset} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.handle} />
          <View style={styles.top}>
            <Text variant="title" style={{ flex: 1 }}>
              {T.title}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={22} color={colors.foreground} />
            </Pressable>
          </View>
          {sent ? (
            <View style={styles.thanks} accessibilityLiveRegion="polite">
              <CircleCheck size={36} color={colors.visit} />
              <Text variant="heading" style={{ textAlign: "center" }}>
                {T.thanks}
              </Text>
              <Button label={T.done} onPress={onClose} style={{ alignSelf: "stretch" }} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.lg }} keyboardShouldPersistTaps="handled">
              <Text variant="label" numberOfLines={2}>
                {videoTitle}
              </Text>
              <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={T.reasons}>
                <Text variant="label">{T.reasons}</Text>
                {REPORT_REASONS.map((option) => {
                  const on = reason === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => {
                        setReason(option.value);
                        if (error === T.reasonRequired) setError(null);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      style={[styles.reason, on ? styles.reasonOn : null]}
                    >
                      <View style={[styles.dot, on ? styles.dotOn : null]}>{on ? <View style={styles.dotInner} /> : null}</View>
                      <Text style={styles.reasonText}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Field
                label={T.noteLabel}
                value={note}
                onChangeText={setNote}
                maxLength={NOTE_MAX}
                multiline
                hint={T.noteHint}
                error={noteError}
              />
              <FormError message={error} />
              <Button label={T.send} busy={sending} onPress={() => void send()} />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(23,20,38,0.45)" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "92%",
    paddingHorizontal: space.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: space.sm,
    backgroundColor: colors.borderStrong,
  },
  top: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  reason: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  reasonOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  reasonText: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.foreground },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  dotOn: { borderColor: colors.brand },
  dotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  thanks: { alignItems: "center", gap: space.md, paddingVertical: space.xl },
});
