/**
 * Where a person's money goes: one MoMo wallet or bank account for selling
 * and for teaching. The server asks Paystack whose name is on the number;
 * the person confirms "Is this you?" before it is saved.
 */

import {trainerFetch} from "./trainer-api";
import type {PayoutBank} from "./types";

export type PayoutAccount = {
  payments_enabled: boolean;
  account: {
    bank_code: string;
    bank_name: string;
    bank_type: string;
    account_last4: string;
    account_name: string;
    name_check: "matches" | "different" | "no_id" | "unknown";
    /** The name differs from the ID: money waits until staff have looked. */
    waiting_for_staff: boolean;
  } | null;
  /** Their sign-in number and the network it looks like. */
  suggestion: {number: string; network: string; bank_code: string};
  banks: PayoutBank[];
};

export type PayoutCheck = {name: string; bank_name: string; account_last4: string};

export function getPayoutAccount() {
  return trainerFetch<PayoutAccount>("/api/payout-account/");
}

export function checkPayoutAccount(body: {bank_code: string; account_number: string}) {
  return trainerFetch<PayoutCheck>("/api/payout-account/check/", {method: "POST", body: JSON.stringify(body)});
}

export function savePayoutAccount(body: {bank_code: string; account_number: string; confirmed_name: string}) {
  return trainerFetch<PayoutAccount>("/api/payout-account/", {method: "PUT", body: JSON.stringify(body)});
}
