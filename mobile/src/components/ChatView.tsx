import { Image } from "expo-image";
import { router } from "expo-router";
import { Send } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { mediaUrl } from "@/lib/media";
import type { ChatMessage } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

/** A chat on screen: bubbles, newest at the foot, and a box to write in. */
export function ChatView({
  title,
  messages,
  loading,
  sending,
  problem,
  onSend,
  initial = "",
}: {
  title: string;
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  problem: string | null;
  onSend: (body: string) => Promise<boolean>;
  initial?: string;
}) {
  const insets = useSafeAreaInsets();
  const [body, setBody] = useState(initial);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }, [messages.length]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    if (await onSend(text)) setBody("");
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <StackHeader eyebrow="MESSAGES" title={title} />
      <ScrollView ref={scroll} contentContainerStyle={styles.list}>
        {loading ? <ActivityIndicator color={colors.brand} /> : null}
        {!loading && !messages.length ? (
          <Text variant="small" style={{ textAlign: "center" }}>
            Your number is not shown to the seller. They reply here and you get a text.
          </Text>
        ) : null}
        {messages.map((message) => {
          const mine = message.sender === "buyer";
          return (
            <View key={message.id} style={[styles.bubbleRow, mine ? styles.right : styles.left]}>
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {message.product ? (
                  <Pressable
                    onPress={() => router.push(`/product/${message.product!.id}`)}
                    style={[styles.product, mine ? styles.productMine : null]}
                    accessibilityRole="link"
                  >
                    {message.product.photo ? (
                      <Image source={mediaUrl(message.product.photo)} style={styles.thumb} contentFit="cover" />
                    ) : null}
                    <Text style={[styles.productText, mine ? { color: "#ffffff" } : null]} numberOfLines={1}>
                      About {message.product.name}
                    </Text>
                  </Pressable>
                ) : null}
                <Text style={[styles.text, mine ? { color: "#ffffff" } : null]}>{message.body}</Text>
                <Text style={[styles.time, mine ? { color: "rgba(255,255,255,0.7)" } : null]}>
                  {new Date(message.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ paddingHorizontal: space.lg }}>
        <FormError message={problem} />
      </View>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { padding: space.lg, gap: space.sm, flexGrow: 1, justifyContent: "flex-end" },
  bubbleRow: { flexDirection: "row" },
  right: { justifyContent: "flex-end" },
  left: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: colors.card, borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  text: { fontSize: 15, lineHeight: 21, color: colors.foreground },
  time: { fontSize: 10, marginTop: 2, color: colors.mutedForeground, alignSelf: "flex-end" },
  product: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 4,
    marginBottom: 6,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
  },
  productMine: { backgroundColor: "rgba(255,255,255,0.16)" },
  thumb: { width: 32, height: 32, borderRadius: 6 },
  productText: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 12, color: colors.foreground },
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
