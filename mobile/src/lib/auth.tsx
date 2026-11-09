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
};

export type AccountState = {
  authenticated: boolean;
  account: Account | null;
  roles: {
    trainee: { href: string } | null;
    trainer: { href: string; status: string } | null;
    seller: { href: string; status: string } | null;
  } | null;
};

type Auth = {
  /** False until the saved token has been read from the phone. */
  ready: boolean;
  signedIn: boolean;
  account: Account | null;
  roles: AccountState["roles"];
  requestCode: (phone: string) => Promise<{ challenge_id: string; expires_in_seconds: number }>;
  verifyCode: (input: { phone: string; code: string; challenge_id: string; name?: string }) => Promise<void>;
  /** Make this login a trainee too, for courses: once, and silently. */
  ensureTrainee: () => Promise<void>;
  signOut: () => Promise<void>;
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
        await saveToken(reply.token);
        client.setQueryData(["account"], { authenticated: true, account: reply.account, roles: reply.roles });
        setHasToken(true);
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
    }),
    [ready, hasToken, account.data, client, forget],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth outside AuthProvider");
  return auth;
}
