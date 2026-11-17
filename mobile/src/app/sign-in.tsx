import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Eye, EyeOff, KeyRound, MailCheck, MessageSquareText, X } from "lucide-react-native";
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
 * Sign in with a phone number or email and a password, create an account
 * (phone, email, password), or ask for a link to set a new password: the
 * same login as the website (backend accounts/passwords.py). The phone code
 * is offered too ("Send me a code instead") only while it is switched on,
 * because SMS codes cannot be relied on yet.
 *
 * Opened as a sheet from wherever sign-in is needed; `why` says what for
 * ("to send an enquiry"), and it closes back to that screen when done.
 */
export default function SignInScreen() {
  const { why } = useLocalSearchParams<{ why?: string }>();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [mode, setMode] = useState<"sign_in" | "register" | "forgot" | "code">("sign_in");
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

  function done() {
    if (router.canGoBack()) router.back();
    else router.replace("/me");
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
            onPress={() =>
              mode === "code" && step === "code"
                ? setStep("phone")
                : mode !== "sign_in"
                  ? setMode("sign_in")
                  : router.back()
            }
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={mode === "sign_in" ? "Close" : "Back"}
            style={styles.iconButton}
          >
            {mode === "sign_in" ? <X size={22} color={colors.foreground} /> : <ArrowLeft size={22} color={colors.foreground} />}
          </Pressable>
        </View>

        {mode !== "code" ? (
          <PasswordForms
            mode={mode}
            why={why}
            setMode={setMode}
            onDone={done}
            onUseCode={auth.codeSignIn ? () => setMode("code") : undefined}
          />
        ) : (
        <>

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
        </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PasswordForms({
  mode,
  why,
  setMode,
  onDone,
  onUseCode,
}: {
  mode: "sign_in" | "register" | "forgot";
  why?: string;
  setMode: (mode: "sign_in" | "register" | "forgot") => void;
  onDone: () => void;
  onUseCode?: () => void;
}) {
  const auth = useAuth();
  const [login, setLogin] = useState("");
  const [typedPhone, setTypedPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);

  function go(next: "sign_in" | "register" | "forgot") {
    setProblem(null);
    setFields({});
    setSent(null);
    setMode(next);
  }

  async function submit() {
    setProblem(null);
    setFields({});
    if (mode === "register") {
      const phone = ghanaPhone(typedPhone);
      const wrong: Record<string, string> = {};
      if (!phone) wrong.phone = "Enter a Ghana mobile number, like 024 123 4567.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) wrong.email = "Enter an email address, like you@example.com.";
      if (password.length < 8) wrong.password = "At least 8 characters.";
      if (Object.keys(wrong).length) {
        setFields(wrong);
        return;
      }
    } else if (!login.trim()) {
      setFields({ login: "Type your phone number or email." });
      return;
    }
    setBusy(true);
    try {
      if (mode === "sign_in") {
        await auth.signInWithPassword(login.trim(), password);
        onDone();
      } else if (mode === "register") {
        await auth.register({ phone: ghanaPhone(typedPhone) ?? "", email: email.trim(), password, name: name.trim() });
        onDone();
      } else {
        setSent(await auth.forgotPassword(login.trim()));
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setFields(error.fields);
        setProblem(error.fields.detail ?? (Object.keys(error.fields).length ? null : error.message));
      } else {
        setProblem("That did not work. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const passwordField = (label: string, hint?: string) => (
    <View>
      <Field
        label={label}
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!show}
        autoComplete={mode === "register" ? "new-password" : "current-password"}
        textContentType={mode === "register" ? "newPassword" : "password"}
        autoCapitalize="none"
        hint={hint}
        error={fields.password}
        onSubmitEditing={() => void submit()}
        returnKeyType="go"
      />
      <Pressable
        onPress={() => setShow((on) => !on)}
        accessibilityRole="button"
        accessibilityLabel={show ? "Hide password" : "Show password"}
        style={styles.eye}
        hitSlop={6}
      >
        {show ? <EyeOff size={20} color={colors.mutedForeground} /> : <Eye size={20} color={colors.mutedForeground} />}
      </Pressable>
    </View>
  );

  const link = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.link}>
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <View style={styles.badge}>
        <KeyRound size={28} color={colors.brand} />
      </View>
      {mode === "forgot" ? (
        <>
          <Text variant="display" style={styles.title}>
            Set a new password
          </Text>
          <Text style={styles.lead}>Type your phone number or email. We email you a link to set a new password.</Text>
          <View style={styles.form}>
            {sent ? (
              <View style={styles.sent} accessibilityLiveRegion="polite">
                <MailCheck size={18} color={colors.visit} />
                <Text style={{ flex: 1, color: colors.visit }}>{sent}</Text>
              </View>
            ) : null}
            <Field
              label="Phone number or email"
              value={login}
              onChangeText={setLogin}
              autoCapitalize="none"
              autoComplete="username"
              placeholder="024 123 4567 or you@example.com"
              error={fields.login}
            />
            <FormError message={problem} />
            <Button label="Email me a link" onPress={() => void submit()} busy={busy} />
            <Text variant="small">No email on your account? Contact support and we will set a password for you.</Text>
            {link("Back to sign in", () => go("sign_in"))}
          </View>
        </>
      ) : mode === "register" ? (
        <>
          <Text variant="display" style={styles.title}>
            Create your account
          </Text>
          <Text style={styles.lead}>
            {why ? `Create an account ${why}. ` : ""}Your courses, orders and saved things follow you to any phone.
          </Text>
          <View style={styles.form}>
            <Field
              label="Phone number"
              prefix="+233"
              value={typedPhone}
              onChangeText={setTypedPhone}
              placeholder="24 123 4567"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              error={fields.phone}
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              hint="For your receipts, and to reset your password if you forget it."
              error={fields.email}
            />
            <Field
              label="Your name (optional)"
              value={name}
              onChangeText={setName}
              placeholder="Ama Owusu"
              autoComplete="name"
              textContentType="name"
              maxLength={120}
            />
            {passwordField("Choose a password", "At least 8 characters. Not just numbers.")}
            <FormError message={problem} />
            <Button label="Create my account" onPress={() => void submit()} busy={busy} />
            {link("Already have an account? Sign in", () => go("sign_in"))}
            {onUseCode ? link("Send me a code instead", onUseCode) : null}
          </View>
        </>
      ) : (
        <>
          <Text variant="display" style={styles.title}>
            Sign in
          </Text>
          <Text style={styles.lead}>
            {why ? `Sign in ${why}. ` : ""}With your phone number or email and your password.
          </Text>
          <View style={styles.form}>
            <Field
              label="Phone number or email"
              value={login}
              onChangeText={setLogin}
              autoCapitalize="none"
              autoComplete="username"
              textContentType="username"
              placeholder="024 123 4567 or you@example.com"
              error={fields.login}
            />
            {passwordField("Password")}
            <FormError message={problem} />
            <Button label="Sign in" onPress={() => void submit()} busy={busy} />
            {link("Forgot your password?", () => go("forgot"))}
            {link("Signed up with a code before? Set a password", () => go("forgot"))}
            {link("New here? Create an account", () => go("register"))}
            {onUseCode ? link("Send me a code instead", onUseCode) : null}
          </View>
        </>
      )}
    </>
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
  eye: { position: "absolute", right: 4, top: 30, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.brand },
  sent: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.visitBg },
});
