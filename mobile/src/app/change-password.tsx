import { router } from "expo-router";
import { CircleCheck, Eye, EyeOff } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { Text } from "@/components/Text";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, radius, space } from "@/theme/tokens";

/** The website's words (frontend/messages/en.json, AccountPassword and SignIn). */
const T = {
  changeLead: "Change the password you sign in with.",
  setLead: "Set a password to sign in with your phone number or email.",
  current: "Current password",
  new: "New password",
  hint: "At least 8 characters. Not just numbers.",
  change: "Change password",
  set: "Set password",
  currentRequired: "Enter your current password.",
  tooShort: "At least 8 characters.",
  changed: "Password changed. Your other phones and browsers are signed out.",
  setDone: "Password set. Your other phones and browsers are signed out.",
  failed: "That did not work. Try again.",
  show: "Show password",
  hide: "Hide password",
};

type Fields = { current_password?: string; password?: string };

/** Every message the server gave for a field, one per line: a new password can break more than one rule. */
function messagesFor(body: unknown, key: keyof Fields): string | undefined {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const lines = value.filter((line): line is string => typeof line === "string");
    return lines.length ? lines.join("\n") : undefined;
  }
  return undefined;
}

/**
 * Set or change the password, as on the website's account page
 * (frontend/src/components/account/AccountSecurity.tsx). An account made
 * with a phone code has none yet, so it only chooses a new one. This phone
 * stays signed in; the server signs out the others.
 */
export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  // An older server does not say: ask for the current one, as it would.
  const has = auth.account?.has_password !== false;
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function save() {
    const wrong: Fields = {
      current_password: has && !current ? T.currentRequired : undefined,
      password: password.length < 8 ? T.tooShort : undefined,
    };
    setFields(wrong);
    setProblem(null);
    setDone(null);
    if (wrong.current_password || wrong.password) return;

    setBusy(true);
    try {
      await auth.changePassword(has ? { current_password: current, password } : { password });
      setCurrent("");
      setPassword("");
      setShow(false);
      // Said for what was done: once saved, the form becomes "change".
      setDone(has ? T.changed : T.setDone);
    } catch (error) {
      const body = error instanceof ApiError ? error.body : null;
      const fromServer: Fields = {
        current_password: messagesFor(body, "current_password"),
        password: messagesFor(body, "password"),
      };
      if (fromServer.current_password || fromServer.password) setFields(fromServer);
      // Sign in first (401), too many tries (429), no connection: the server's words.
      else setProblem(error instanceof ApiError ? error.message : T.failed);
    } finally {
      setBusy(false);
    }
  }

  // One switch for both boxes, on each, as on the website.
  const eye = (
    <Pressable
      onPress={() => setShow((on) => !on)}
      accessibilityRole="button"
      accessibilityLabel={show ? T.hide : T.show}
      style={styles.eye}
      hitSlop={6}
    >
      {show ? <EyeOff size={20} color={colors.mutedForeground} /> : <Eye size={20} color={colors.mutedForeground} />}
    </Pressable>
  );

  if (!auth.signedIn) {
    return (
      <View style={styles.screen}>
        <StackHeader eyebrow="ACCOUNT" title="Password" />
        <View style={[styles.card, { margin: space.lg }]}>
          <Text variant="body">Sign in to set or change your password.</Text>
          <Button
            label="Sign in"
            onPress={() => router.push({ pathname: "/sign-in", params: { why: "to change your password" } })}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="ACCOUNT" title="Password" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}
        >
          <Text variant="body">{has ? T.changeLead : T.setLead}</Text>
          {done ? (
            <View style={styles.done} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <CircleCheck size={18} color={colors.visit} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, color: colors.foreground }}>{done}</Text>
            </View>
          ) : null}
          <FormError message={problem} />
          {has ? (
            <View>
              <Field
                label={T.current}
                value={current}
                onChangeText={(text) => {
                  setCurrent(text);
                  setFields((now) => ({ ...now, current_password: undefined }));
                }}
                secureTextEntry={!show}
                autoComplete="current-password"
                textContentType="password"
                autoCapitalize="none"
                autoCorrect={false}
                error={fields.current_password}
                returnKeyType="next"
              />
              {eye}
            </View>
          ) : null}
          <View>
            <Field
              label={T.new}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setFields((now) => ({ ...now, password: undefined }));
              }}
              secureTextEntry={!show}
              autoComplete="new-password"
              textContentType="newPassword"
              autoCapitalize="none"
              autoCorrect={false}
              hint={T.hint}
              error={fields.password}
              onSubmitEditing={() => void save()}
              returnKeyType="go"
            />
            {eye}
          </View>
          <Button label={has ? T.change : T.set} busy={busy} onPress={() => void save()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // Over the right end of the box, as on the sign-in screen.
  eye: { position: "absolute", right: 4, top: 30, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  done: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.visitBg },
});
