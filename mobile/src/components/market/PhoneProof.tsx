import { router } from "expo-router";
import { LogIn } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button, Field } from "@/components/Form";
import { Text } from "@/components/Text";
import { useAuth } from "@/lib/auth";
import { ghanaPhone, showPhone } from "@/lib/phone";
import { colors, radius, space } from "@/theme/tokens";

export type PhoneProof = ReturnType<typeof usePhoneProof>;

/**
 * The buyer's phone on a buying form, proved on the same form: no separate
 * sign-in. Signed in, it is their own number and no code is asked for. Not
 * signed in, the first press texts a code to the number typed and shows a
 * box for it under the phone; the next press checks the code, which signs
 * them in to the app silently (a first one makes the account).
 *
 * While the code is switched off (SMS cannot be relied on), someone not
 * signed in is asked to sign in or create an account first (phone, password,
 * and an email if they like) instead; once they are back, it is their own number.
 *
 * `prove()` returns the proved number, or null when the code has just been
 * sent and the form should wait for it (or the number is wrong; `error`
 * says so).
 */
export function usePhoneProof() {
  const auth = useAuth();
  const [typed, setTyped] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const own = auth.signedIn ? (auth.account?.phone ?? null) : null;

  const needsSignIn = !own && !auth.codeSignIn;

  async function prove(name?: string): Promise<string | null> {
    if (own) return own;
    if (needsSignIn) {
      setError("Sign in or create an account first.");
      return null;
    }
    const e164 = ghanaPhone(typed);
    if (!e164) {
      setError("Enter a Ghana mobile number, like 024 123 4567.");
      return null;
    }
    setError(undefined);
    if (!challenge || sentTo !== e164) {
      const reply = await auth.requestCode(e164);
      setSentTo(e164);
      setChallenge(reply.challenge_id);
      setCode("");
      return null;
    }
    if (code.length < 6) {
      setError("Type the 6-digit code we texted you.");
      return null;
    }
    // Signs in silently; the code is used up either way.
    await auth.verifyCode({
      phone: e164,
      code,
      challenge_id: challenge,
      name: name?.trim() || undefined,
    });
    return e164;
  }

  return {
    own,
    needsSignIn,
    typed,
    setTyped: (value: string) => {
      setTyped(value);
      setChallenge(null);
      setSentTo(null);
    },
    /** The code is on its way and the next press checks it. */
    waiting: !own && Boolean(challenge),
    sentTo,
    code,
    setCode: (value: string) => setCode(value.replace(/\D/g, "").slice(0, 6)),
    error,
    prove,
  };
}

/** The phone box, and the code box under it once a code was sent. */
export function PhoneProofFields({ proof }: { proof: PhoneProof }) {
  if (proof.own) {
    return (
      <View style={styles.own}>
        <Text variant="label">Your phone</Text>
        <Text>{showPhone(proof.own)}</Text>
        <Text variant="small">
          The maker calls or messages you on this number.
        </Text>
      </View>
    );
  }
  if (proof.needsSignIn) {
    return (
      <View style={styles.signIn}>
        <Text variant="label">Sign in or create an account</Text>
        <Text variant="small">
          So the maker knows who the order is from and can reach you: your phone number and a password.
        </Text>
        <Button
          label="Sign in or create an account"
          icon={<LogIn size={18} color="#fff" />}
          onPress={() => router.push({ pathname: "/sign-in", params: { why: "to order" } })}
        />
        {proof.error ? <Text style={{ color: colors.destructive }}>{proof.error}</Text> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: space.md }}>
      <Field
        label="Your phone number"
        hint="We text you a code to check it. No password, no sign-up."
        value={proof.typed}
        onChangeText={proof.setTyped}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="024 123 4567"
        error={proof.waiting ? undefined : proof.error}
      />
      {proof.waiting && proof.sentTo ? (
        <View style={styles.code}>
          <Field
            autoFocus
            label={`The code sent to ${showPhone(proof.sentTo)}`}
            value={proof.code}
            onChangeText={proof.setCode}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            error={proof.error}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  signIn: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  own: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  code: {
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
});
