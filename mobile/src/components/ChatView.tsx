import { Image } from "expo-image";
import { router } from "expo-router";
import { Flag, GraduationCap, Phone, Send } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FormError } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { Text } from "@/components/Text";
import { photoUrl } from "@/lib/media";
import type { ChatMessage, ChatReportReason } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

const REASONS: { value: ChatReportReason; label: string }[] = [
  { value: "scam", label: "It looks like a scam" },
  { value: "money", label: "They asked for money that was not agreed" },
  { value: "abuse", label: "Rude, abusive or unwanted" },
  { value: "other", label: "Something else" },
];

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * A chat on screen: bubbles, newest at the foot, and a box to write in. The
 * same view for the person (their Messages) and the business (the inbox).
 * Numbers stay hidden until somebody taps "Share my number", which shares
 * only their own; a shared number shows as a bubble with a Call button.
 */
export function ChatView({
  title,
  messages,
  loading,
  sending,
  problem,
  onSend,
  initial = "",
  me = "buyer",
  kindLabel,
  onOpenPage,
  onShare,
  onReport,
}: {
  title: string;
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  problem: string | null;
  onSend: (body: string) => Promise<boolean>;
  initial?: string;
  /** Whose side of the chat this phone is on: the person's, or the business's. */
  me?: "buyer" | "seller";
  /** "WORKSHOP" or "SHOP" above the name. */
  kindLabel?: string;
  /** The person's side: open the shop's or the workshop's page. */
  onOpenPage?: () => void;
  onShare?: () => Promise<void>;
  onReport?: (reason: ChatReportReason, details: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [body, setBody] = useState(initial);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [sharing, setSharing] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }, [messages.length]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    if (await onSend(text)) setBody("");
  }

  function share() {
    if (!onShare) return;
    Alert.alert("Share your number?", `${title} will see it and can call you.`, [
      { text: "Not now", style: "cancel" },
      {
        text: "Share",
        onPress: () => {
          setSharing(true);
          onShare()
            .catch((error: Error) => Alert.alert("That did not work", error.message))
            .finally(() => setSharing(false));
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <StackHeader
        eyebrow={kindLabel ?? "MESSAGES"}
        title={title}
        action={
          onReport ? (
            <Pressable
              onPress={() => setReporting((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel="Report this chat"
              hitSlop={8}
              style={styles.report}
            >
              <Flag size={18} color={colors.mutedForeground} />
            </Pressable>
          ) : undefined
        }
      />
      {onOpenPage ? (
        <Pressable onPress={onOpenPage} accessibilityRole="link" style={styles.pageLink}>
          <Text style={styles.pageLinkText}>See their page</Text>
        </Pressable>
      ) : null}
      {reporting && onReport ? (
        <ReportPanel
          onCancel={() => setReporting(false)}
          onSend={async (reason, details) => {
            await onReport(reason, details);
            setReporting(false);
            setReported(true);
          }}
        />
      ) : null}
      {reported ? (
        <Text style={styles.reported} accessibilityLiveRegion="polite">
          Thank you. Fliiptech staff will look at this chat.
        </Text>
      ) : null}
      <ScrollView ref={scroll} contentContainerStyle={styles.list}>
        {loading ? <ActivityIndicator color={colors.brand} /> : null}
        {!loading && !messages.length ? (
          <Text variant="small" style={{ textAlign: "center" }}>
            Your number is not shown. They reply here and you get a notice.
          </Text>
        ) : null}
        {messages.map((message) => {
          const mine = message.sender === me;
          const ink = mine ? { color: "#ffffff" } : null;
          if (message.kind === "phone") {
            return (
              <View key={message.id} style={[styles.bubbleRow, mine ? styles.right : styles.left]}>
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  <Text style={[styles.cardTitle, ink]}>{mine ? "You shared your number" : "Shared their number"}</Text>
                  {mine ? (
                    <Text style={[styles.text, ink]}>{message.body}</Text>
                  ) : (
                    <Pressable
                      onPress={() => void Linking.openURL(`tel:${message.body}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${message.body}`}
                      style={styles.call}
                    >
                      <Phone size={16} color="#ffffff" />
                      <Text style={styles.callText}>Call {message.body}</Text>
                    </Pressable>
                  )}
                  <Text style={[styles.time, mine ? styles.timeMine : null]}>{time(message.created_at)}</Text>
                </View>
              </View>
            );
          }
          return (
            <View key={message.id} style={[styles.bubbleRow, mine ? styles.right : styles.left]}>
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {message.product ? (
                  <Pressable
                    onPress={() => router.push(`/product/${message.product!.id}`)}
                    style={[styles.card, mine ? styles.cardMine : null]}
                    accessibilityRole="link"
                  >
                    {message.product.photo ? (
                      <Image source={photoUrl(message.product.photo)} style={styles.thumb} contentFit="cover" />
                    ) : null}
                    <Text style={[styles.cardText, ink]} numberOfLines={1}>
                      About {message.product.name}
                    </Text>
                  </Pressable>
                ) : null}
                {message.kind === "enquiry" && message.course ? (
                  <View style={[styles.card, styles.course, mine ? styles.cardMine : null]}>
                    <GraduationCap size={18} color={mine ? "#ffffff" : colors.brand} />
                    <View style={{ flexShrink: 1 }}>
                      <Text style={[styles.cardText, ink]} numberOfLines={2}>
                        Enquiry: {message.course.title}
                      </Text>
                      <Text style={[styles.cardSmall, mine ? styles.timeMine : null]}>
                        {message.course.starts
                          ? `Starts ${new Date(message.course.starts).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · `
                          : ""}
                        Reference {message.course.reference}
                      </Text>
                    </View>
                  </View>
                ) : null}
                <Text style={[styles.text, ink]}>{message.body}</Text>
                <Text style={[styles.time, mine ? styles.timeMine : null]}>{time(message.created_at)}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ paddingHorizontal: space.lg }}>
        <FormError message={problem} />
      </View>
      {onShare && !loading ? (
        <View style={styles.shareBar}>
          <Text variant="small" style={{ flex: 1 }}>
            Your number is hidden. Share it only if you want them to call you.
          </Text>
          <Pressable
            onPress={share}
            disabled={sharing}
            accessibilityRole="button"
            style={[styles.shareButton, sharing ? { opacity: 0.5 } : null]}
          >
            <Phone size={14} color={colors.brand} />
            <Text style={styles.shareText}>Share my number</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.composer, { paddingBottom: insets.bottom + space.sm }]}>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Write a message"
          placeholderTextColor={colors.mutedForeground}
          multiline
          maxLength={1000}
          style={styles.input}
          accessibilityLabel="Your message"
        />
        <Pressable
          onPress={() => void send()}
          disabled={sending || !body.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={[styles.send, sending || !body.trim() ? { opacity: 0.5 } : null]}
        >
          {sending ? <ActivityIndicator color="#ffffff" /> : <Send size={20} color="#ffffff" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Why this chat is being reported. Inline, not an alert: Android alerts hold three buttons. */
function ReportPanel({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (reason: ChatReportReason, details: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    if (!reason) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSend(reason, details.trim());
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That did not send. Try again.");
      setBusy(false);
    }
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.cardTitle}>Report this chat</Text>
      <Text variant="small">Fliiptech staff will read this chat. The other person is not told who reported it.</Text>
      {REASONS.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => setReason(option.value)}
          accessibilityRole="radio"
          accessibilityState={{ checked: reason === option.value }}
          style={[styles.reason, reason === option.value ? styles.reasonOn : null]}
        >
          <Text style={[styles.reasonText, reason === option.value ? { color: colors.brand } : null]}>{option.label}</Text>
        </Pressable>
      ))}
      <TextInput
        value={details}
        onChangeText={setDetails}
        placeholder="Anything else staff should know (optional)"
        placeholderTextColor={colors.mutedForeground}
        multiline
        maxLength={1000}
        style={[styles.input, { flex: 0, backgroundColor: colors.card }]}
      />
      <FormError message={problem} />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Pressable
          onPress={() => void submit()}
          disabled={!reason || busy}
          accessibilityRole="button"
          style={[styles.panelButton, { backgroundColor: colors.brand }, !reason || busy ? { opacity: 0.5 } : null]}
        >
          <Text style={[styles.shareText, { color: "#ffffff" }]}>Send report</Text>
        </Pressable>
        <Pressable onPress={onCancel} accessibilityRole="button" style={styles.panelButton}>
          <Text style={styles.shareText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  report: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  pageLink: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  pageLinkText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },
  reported: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.visit,
    backgroundColor: colors.visitBg,
  },
  list: { padding: space.lg, gap: space.sm, flexGrow: 1, justifyContent: "flex-end" },
  bubbleRow: { flexDirection: "row" },
  right: { justifyContent: "flex-end" },
  left: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: colors.card, borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  text: { fontSize: 15, lineHeight: 21, color: colors.foreground },
  time: { fontSize: 10, marginTop: 2, color: colors.mutedForeground, alignSelf: "flex-end" },
  timeMine: { color: "rgba(255,255,255,0.7)" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 4,
    marginBottom: 6,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
  },
  course: { padding: space.sm, alignItems: "flex-start" },
  cardMine: { backgroundColor: "rgba(255,255,255,0.16)" },
  thumb: { width: 32, height: 32, borderRadius: 6 },
  cardText: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 12, color: colors.foreground },
  cardSmall: { fontSize: 11, marginTop: 2, color: colors.mutedForeground },
  cardTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.foreground, marginBottom: 4 },
  call: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.visit,
  },
  callText: { fontFamily: fonts.bold, fontSize: 14, color: "#ffffff" },
  shareBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  shareText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },
  panel: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.muted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  reason: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  reasonOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  reasonText: { fontSize: 14, color: colors.foreground },
  panelButton: {
    minHeight: 40,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: space.md,
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: 22,
    backgroundColor: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.foreground,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
  },
});
