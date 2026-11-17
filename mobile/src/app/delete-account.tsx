import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { Text } from "@/components/Text";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, radius, space } from "@/theme/tokens";

const WORD = "DELETE";

/**
 * Delete my account, for the whole login: shop and workshop included
 * (backend accounts/removal.py). What goes and the money records that stay
 * are said first; a password account gives its password, and everyone types
 * DELETE, so it is never pressed by accident.
 */
export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const hasPassword = auth.account?.has_password !== false;
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === WORD && (!hasPassword || password.length > 0);

  async function remove() {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      await auth.deleteAccount(hasPassword ? password : undefined);
      router.replace("/");
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That did not work. Try again.");
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StackHeader eyebrow="ACCOUNT" title="Delete my account" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}
        >
          <View style={styles.card}>
            <Text variant="label">Deleted</Text>
            <Text>
              Your sign-in, name, email, photo and addresses; your saved items, basket, saved workshops and searches; and,
              if you have one, your shop with all its products and photos, and your workshop page with its photos, videos
              and online course. They leave the app and website at once and are removed from our server.
            </Text>
            <Text variant="label">Kept</Text>
            <Text>
              Only money records: paid orders, payments and paid course sales, because they are the other person&apos;s
              receipt and are needed for refunds and the books. They are kept without your name, phone, email or bank
              details.
            </Text>
            <Text variant="small">This cannot be undone.</Text>
          </View>
          <FormError message={problem} />
          {hasPassword ? (
            <Field
              label="Your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
            />
          ) : null}
          <Field
            label={`Type ${WORD} to confirm`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Button label="Delete everything for good" onPress={remove} busy={busy} disabled={!ready} />
          <Button label="No, keep my account" tone="outline" onPress={() => router.back()} disabled={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.destructive,
    backgroundColor: colors.card,
  },
});
