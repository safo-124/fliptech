import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Device from "expo-device";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { getJson, postJson } from "./api";
import { loadToken, saveToken, token } from "./session";

export type Account = {
  phone: string;
  display_name: string;
  /** Their own picture, or null. */
  photo: string | null;
  email: string | null;
  delivery_address: string;
  created_at: string;
  /** False for an account made with a phone code: it can set one. */
  has_password?: boolean;
  email_verified?: boolean;
  /** False for a number given at sign-up and never proven with a code. */
  phone_verified?: boolean;
};

export type AccountState = {
  authenticated: boolean;
  account: Account | null;
  roles: {
    trainee: { href: string } | null;
    trainer: { href: string; status: string } | null;
    seller: { id?: number; href: string; status: string } | null;
  } | null;
  /** Whether the phone code is offered besides a password (backend PHONE_CODE_SIGN_IN). */
  sign_in?: { code: boolean };
};

type Auth = {
  /** False until the saved token has been read from the phone. */
  ready: boolean;
  signedIn: boolean;
  account: Account | null;
  roles: AccountState["roles"];
  requestCode: (phone: string) => Promise<{ challenge_id: string; expires_in_seconds: number }>;
  verifyCode: (input: { phone: string; code: string; challenge_id: string; name?: string }) => Promise<void>;
  /** Phone number (however typed) or email, and the password. */
  signInWithPassword: (login: string, password: string) => Promise<void>;
  register: (input: { phone: string; email?: string; password: string; name?: string }) => Promise<void>;
  /** Emails a link to set a new password; the answer says so, whoever asks. */
  forgotPassword: (login: string) => Promise<string>;
  /**
   * Set a first password (no `current_password`) or change it. This phone
   * stays signed in; the server signs out every other phone and browser.
   */
  changePassword: (input: { current_password?: string; password: string }) => Promise<void>;
  /** False while SMS codes cannot be relied on: password only. */
  codeSignIn: boolean;
  /** Make this login a trainee too, for courses: once, and silently. */
  ensureTrainee: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Delete the whole login, shop and workshop included; signs out here. */
  deleteAccount: (password?: string) => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

/**
 * Who is signed in to the app. The token lives in secure storage; the
 * account comes from /api/account/ and is refreshed with the other data.
 * A token the server no longer accepts (signed out elsewhere, revoked by
 * staff) reads as signed out, and is forgotten.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    void loadToken().then((saved) => {
      setHasToken(Boolean(saved));
      setReady(true);
    });
  }, []);

  const forget = useCallback(async () => {
    await saveToken(null);
    setHasToken(false);
    for (const key of ["account", "my-courses", "orders"]) client.removeQueries({ queryKey: [key] });
  }, [client]);

  const account = useQuery({
    queryKey: ["account"],
    queryFn: async () => {
      const state = await getJson<AccountState>("/api/account/");
      // The server no longer knows this token: forget it.
      if (!state.authenticated && token()) await forget();
      return state;
    },
    enabled: ready && hasToken,
    staleTime: 5 * 60_000,
  });

  // Whether the code is offered: asked of the server, signed in or not.
  const methods = useQuery({
    queryKey: ["sign-in-methods"],
    queryFn: async () => (await getJson<AccountState>("/api/account/")).sign_in ?? { code: false },
    enabled: ready,
    staleTime: 10 * 60_000,
  });

  const keepToken = useCallback(
    async (reply: AccountState & { token: string }) => {
      await saveToken(reply.token);
      client.setQueryData(["account"], { authenticated: true, account: reply.account, roles: reply.roles, sign_in: reply.sign_in });
      setHasToken(true);
    },
    [client],
  );

  const value = useMemo<Auth>(
    () => ({
      ready,
      signedIn: hasToken && Boolean(account.data?.authenticated),
      account: account.data?.account ?? null,
      roles: account.data?.roles ?? null,
      requestCode: (phone) => postJson("/api/app/request-code/", { phone }),
      async verifyCode({ phone, code, challenge_id, name }) {
        const device = [Device.manufacturer, Device.modelName].filter(Boolean).join(" ");
        const reply = await postJson<AccountState & { token: string }>("/api/app/verify-code/", {
          phone,
          code,
          challenge_id,
          name: name || undefined,
          device,
        });
        await keepToken(reply);
      },
      codeSignIn: Boolean(methods.data?.code),
      async signInWithPassword(login, password) {
        const device = [Device.manufacturer, Device.modelName].filter(Boolean).join(" ");
        await keepToken(
          await postJson<AccountState & { token: string }>("/api/app/sign-in/", { login, password, device }),
        );
      },
      async register({ phone, email, password, name }) {
        const device = [Device.manufacturer, Device.modelName].filter(Boolean).join(" ");
        await keepToken(
          await postJson<AccountState & { token: string }>("/api/app/register/", {
            phone,
            email: email || undefined,
            password,
            name: name || undefined,
            device,
          }),
        );
      },
      async forgotPassword(login) {
        return (await postJson<{ detail: string }>("/api/account/password/forgot/", { login })).detail;
      },
      async changePassword(input) {
        // The account as it now is: has_password is true from here on.
        client.setQueryData(["account"], await postJson<AccountState>("/api/account/password/", input));
      },
      async ensureTrainee() {
        if (account.data?.roles?.trainee) return;
        const reply = await postJson<AccountState>("/api/account/roles/trainee/");
        client.setQueryData(["account"], reply);
      },
      async signOut() {
        try {
          await postJson("/api/app/sign-out/");
        } catch {
          // Signed out on this phone either way.
        }
        await forget();
        client.invalidateQueries();
      },
      async deleteAccount(password) {
        await postJson("/api/account/close/", password === undefined ? { confirm: true } : { confirm: true, password });
        await forget();
        client.clear();
      },
    }),
    [ready, hasToken, account.data, client, forget, keepToken, methods.data],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth outside AuthProvider");
  return auth;
}
