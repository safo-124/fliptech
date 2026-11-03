import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, MessageSquareText, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, FormError } from "@/components/Form";
import { Text } from "@/components/Text";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ghanaPhone, showPhone } from "@/lib/phone";
import { colors, fonts, radius, space } from "@/theme/tokens";

const CODE_LENGTH = 6;
const RESEND_AFTER = 30;

/**
 * Sign in with a phone number and the code texted to it: no passwords.
 * The same login as the website. A first sign-in makes the account.
 *
 * Opened as a sheet from wherever sign-in is needed; `why` says what for
 * ("to send an enquiry"), and it closes back to that screen when done.
 */
export default function SignInScreen() {
  const { why } = useLocalSearchParams<{ why?: string }>();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [typed, setTyped] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [wait, setWait] = useState(0);
  const codeBox = useRef<TextInputInstance>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function sendCode() {
    const e164 = ghanaPhone(typed);
    if (!e164) {
      setPhoneError("Enter a Ghana mobile number, like 024 123 4567.");
      return;
    }
    setPhoneError(undefined);
    setProblem(null);
    setBusy(true);
    try {
      const reply = await auth.requestCode(e164);
      setPhone(e164);
      setChallenge(reply.challenge_id);
      setCode("");
      setStep("code");
      setWait(RESEND_AFTER);
      setTimeout(() => codeBox.current?.focus(), 250);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(entered = code) {
    if (!phone || !challenge || entered.length < CODE_LENGTH) return;
    setProblem(null);
    setBusy(true);
    try {
      await auth.verifyCode({ phone, code: entered, challenge_id: challenge, name: name.trim() });
      if (router.canGoBack()) router.back();
      else router.replace("/me");
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That did not work. Try again.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.top}>
          <Pressable
            onPress={() => (step === "code" ? setStep("phone") : router.back())}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={step === "code" ? "Change the number" : "Close"}
            style={styles.iconButton}
          >
            {step === "code" ? <ArrowLeft size={22} color={colors.foreground} /> : <X size={22} color={colors.foreground} />}
          </Pressable>
        </View>

        <View style={styles.badge}>
          <MessageSquareText size={28} color={colors.brand} />
        </View>

        {step === "phone" ? (
          <>
            <Text variant="display" style={styles.title}>
              Sign in with your phone
            </Text>
            <Text style={styles.lead}>
              {why ? `Sign in ${why}. ` : ""}We text you a code. No password to remember, and your courses, orders and
              saved things follow you to any phone.
            </Text>
            <View style={styles.form}>
              <Field
                label="Phone number"
                prefix="+233"
                value={typed}
                onChangeText={setTyped}
                placeholder="24 123 4567"
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                error={phoneError}
                onSubmitEditing={() => void sendCode()}
                returnKeyType="send"
              />
              <Field
                label="Your name (optional)"
                value={name}
                onChangeText={setName}
                placeholder="Ama Owusu"
                autoComplete="name"
                textContentType="name"
                hint="So workshops and sellers know who they are talking to."
                maxLength={120}
              />
              <FormError message={problem} />
              <Button label="Text me a code" onPress={() => void sendCode()} busy={busy} />
            </View>
          </>
        ) : (
          <>
            <Text variant="display" style={styles.title}>
              Enter the code
            </Text>
            <Text style={styles.lead}>
              We sent a {CODE_LENGTH}-digit code to <Text style={styles.strong}>{phone ? showPhone(phone) : ""}</Text>.
            </Text>
            <Pressable onPress={() => codeBox.current?.focus()} style={styles.codeRow} accessibilityRole="none">
              {Array.from({ length: CODE_LENGTH }, (_, n) => (
                <View key={n} style={[styles.cell, n === code.length ? styles.cellActive : null]}>
                  <Text style={styles.digit}>{code[n] ?? ""}</Text>
                </View>
              ))}
            </Pressable>
            <TextInput
              ref={codeBox}
              value={code}
              onChangeText={(value) => {
                const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
                setCode(digits);
                if (digits.length === CODE_LENGTH) void checkCode(digits);
              }}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={CODE_LENGTH}
              accessibilityLabel="The code from the text"
              style={styles.hiddenInput}
            />
            <View style={styles.form}>
              <FormError message={problem} />
              <Button
                label="Sign in"
                onPress={() => void checkCode()}
                busy={busy}
                disabled={code.length < CODE_LENGTH}
              />
              <Button
                label={wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
                tone="soft"
                disabled={wait > 0 || busy}
                onPress={() => void sendCode()}
              />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { paddingHorizontal: space.xl },
  top: { flexDirection: "row" },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.muted,
  },
  badge: {
    marginTop: space.xl,
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  title: { marginTop: space.lg },
  lead: { marginTop: space.sm, color: colors.mutedForeground, lineHeight: 22 },
  strong: { fontFamily: fonts.bold, color: colors.foreground },
  form: { marginTop: space.xl, gap: space.lg },
  codeRow: { marginTop: space.xl, flexDirection: "row", gap: space.sm },
  cell: {
    flex: 1,
    aspectRatio: 0.85,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  cellActive: { borderColor: colors.brand, borderWidth: 2 },
  digit: { fontFamily: fonts.extrabold, fontSize: 24, color: colors.brandDeep },
  hiddenInput: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
