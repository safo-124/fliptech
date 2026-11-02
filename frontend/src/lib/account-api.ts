/**
 * The one account everyone has. Browser only. See backend accounts/views.py.
 *
 * Signing in here signs the person in everywhere: being a trainee, trainer or
 * seller hangs off the same login, so their dashboards open without another
 * code.
 */

import {trainerFetch as sessionFetch} from "./trainer-fetch";
import type {MarketplaceOrder} from "./types";

export type RoleState = {href: string; status?: "pending" | "confirmed" | "declined"} | null;

export type CustomerAccount = {
  phone: string;
  display_name: string;
  email: string | null;
  delivery_address: string;
  created_at: string;
};

export type AccountSession =
  | {authenticated: false; account: null; roles: null}
  | {
      authenticated: true;
      account: CustomerAccount;
      roles: {trainee: RoleState; trainer: RoleState; seller: RoleState};
    };

export function getAccount() {
  return sessionFetch<AccountSession>("/api/account/");
}

export function requestAccountCode(phone: string) {
  return sessionFetch<{challenge_id: string; expires_in_seconds: number}>("/api/account/request-code/", {
    method: "POST",
    body: JSON.stringify({phone}),
  });
}

export function verifyAccountCode(body: {challenge_id: string; phone: string; code: string; name?: string}) {
  return sessionFetch<AccountSession & {joined: boolean}>("/api/account/verify-code/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateAccount(patch: Partial<Pick<CustomerAccount, "display_name" | "email" | "delivery_address">>) {
  return sessionFetch<AccountSession>("/api/account/", {method: "PATCH", body: JSON.stringify(patch)});
}

export function signOutAccount() {
  return sessionFetch<AccountSession>("/api/account/logout/", {method: "POST"});
}

export function getMyOrders() {
  return sessionFetch<{results: MarketplaceOrder[]}>("/api/account/orders/");
}

export type MyQuestions = {
  questions: {
    reference: string;
    product: number | null;
    product_name: string;
    seller_name: string;
    message: string;
    created_at: string;
  }[];
  quotes: {
    reference: string;
    title: string;
    trade: string;
    state: "open" | "closed";
    makers: string[];
    created_at: string;
  }[];
};

export function getMyQuestions() {
  return sessionFetch<MyQuestions>("/api/account/questions/");
}

export function getSavedIds() {
  return sessionFetch<{ids: number[]}>("/api/account/saved/");
}

export function changeSaved(body: {add?: number[]; remove?: number[]}) {
  return sessionFetch<{ids: number[]}>("/api/account/saved/", {method: "PUT", body: JSON.stringify(body)});
}

export function addRole(role: "trainee" | "trainer" | "seller") {
  return sessionFetch<AccountSession>(`/api/account/roles/${role}/`, {method: "POST"});
}
