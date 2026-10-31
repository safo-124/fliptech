/**
 * The seller's own side. Browser only.
 *
 * Same session-and-CSRF fetch as the trainer and trainee portals: a phone
 * sign-in creates a Django session cookie and every write echoes the CSRF
 * token.
 */

import {trainerFetch as sessionFetch} from "./trainer-api";
import type {MarketplaceOrder, PayoutBank} from "./types";

export {TrainerApiError as SellerApiError} from "./trainer-api";

export type SellerProfile = {
  phone: string;
  email: string | null;
  business_name: string;
  about: string;
  area: number | null;
  approval_status: "pending" | "confirmed" | "declined";
  approval_note: string;
  /** Everything true at once: confirmed, switched on, and the shop filled in. */
  may_sell: boolean;
  /** What is still missing on the seller's own side. Empty is not the same as
      may_sell: the form can be complete while confirmation is still pending. */
  ready_to_sell: ("business_name" | "area")[];
};

export type SellerSession =
  | {authenticated: false; seller: null}
  | {authenticated: true; seller: SellerProfile};

export type SellerProduct = {
  id: number;
  name: string;
  slug: string;
  description: string;
  price: string | null;
  trade: number | null;
  availability: "available" | "made_to_order" | "sold_out";
  status: "draft" | "published" | "suspended";
  status_label: string;
  staff_note: string;
  /** Published is not the same as visible: a published product whose seller
      is not yet confirmed is nowhere to be seen, and the dashboard says so. */
  visible: boolean;
  photos: {id: number; image: string | null; caption: string; display_order: number}[];
  created_at: string;
  updated_at: string;
};

export type SellerEnquiry = {
  id: number;
  reference_code: string;
  product: number | null;
  product_name: string;
  buyer_phone: string;
  buyer_name: string;
  message: string;
  /** Whether anyone has actually passed it on yet. */
  told: boolean;
  reply_url: string;
  created_at: string;
};

export function getSellerSession() {
  return sessionFetch<SellerSession>("/api/seller/session/me/");
}

export function requestSellerCode(phone: string) {
  return sessionFetch<{challenge_id: string; expires_in_seconds: number}>(
    "/api/seller/auth/request-code/",
    {method: "POST", body: JSON.stringify({phone})},
  );
}

export function verifySellerCode(challengeId: string, phone: string, code: string) {
  return sessionFetch<SellerSession>("/api/seller/auth/verify-code/", {
    method: "POST",
    body: JSON.stringify({challenge_id: challengeId, phone, code}),
  });
}

/** Turn selling on for a trainer who is already signed in. No second code. */
export function startSelling() {
  return sessionFetch<SellerProfile>("/api/trainer/selling/", {method: "POST"});
}

export function signOutSeller() {
  return sessionFetch<SellerSession>("/api/seller/logout/", {method: "POST"});
}

export function saveShop(patch: Partial<Pick<SellerProfile, "business_name" | "about" | "area">>) {
  return sessionFetch<SellerProfile>("/api/seller/account/", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function getSellerProducts() {
  return sessionFetch<{results: SellerProduct[]}>("/api/seller/products/");
}

export type ProductInput = {
  name: string;
  description?: string;
  price?: string | null;
  trade?: number | null;
  availability?: SellerProduct["availability"];
};

export function createProduct(body: ProductInput) {
  return sessionFetch<SellerProduct>("/api/seller/products/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateProduct(id: number, body: Partial<ProductInput>) {
  return sessionFetch<SellerProduct>(`/api/seller/products/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteProduct(id: number) {
  return sessionFetch<void>(`/api/seller/products/${id}/`, {method: "DELETE"});
}

export function publishProduct(id: number) {
  return sessionFetch<SellerProduct>(`/api/seller/products/${id}/published/`, {method: "POST"});
}

export function withdrawProduct(id: number) {
  return sessionFetch<SellerProduct>(`/api/seller/products/${id}/published/`, {method: "DELETE"});
}

export function addProductPhoto(id: number, file: File) {
  const body = new FormData();
  body.append("image", file);
  // No Content-Type: the browser has to set the multipart boundary itself.
  return sessionFetch<{id: number; image: string | null}>(
    `/api/seller/products/${id}/photos/`,
    {method: "POST", body},
  );
}

export function removeProductPhoto(id: number, photoId: number) {
  return sessionFetch<void>(`/api/seller/products/${id}/photos/${photoId}/`, {method: "DELETE"});
}

export function getSellerEnquiries() {
  return sessionFetch<{results: SellerEnquiry[]}>("/api/seller/enquiries/");
}

// ---------------------------------------------------------------------------
// Numbers, boosts, the Shop plan, payouts and orders.
// See backend marketplace/selling_views.py.

export type SellerStats = {
  days: number;
  totals: {views: number; enquiries: number; sold: number};
  products: {
    id: number;
    name: string;
    status: SellerProduct["status"];
    views_7d: number;
    views_30d: number;
    enquiries_30d: number;
    sold_30d: number;
    boosted_until: string | null;
  }[];
};

export type BoostKind = "boost_week" | "boost_month";

export type SellerGrowth = {
  payments_enabled: boolean;
  /** Cedis, by what is bought. */
  prices: Record<BoostKind | "plan_month", string>;
  free_product_limit: number;
  published: number;
  plan: {running: boolean; ends_at: string | null; free_boost_available: boolean};
  boosts: {product: number | null; product_name: string; kind: BoostKind; ends_at: string}[];
  banner: string | null;
};

export type SellerPayout = {
  payments_enabled: boolean;
  commission_percent: number;
  payout: {
    ready: boolean;
    bank_code: string;
    bank_name: string;
    account_last4: string;
    account_name: string;
  };
};

export function getSellerStats() {
  return sessionFetch<SellerStats>("/api/seller/stats/");
}

export function getSellerGrowth() {
  return sessionFetch<SellerGrowth>("/api/seller/growth/");
}

/** Pay for a boost (returns Paystack's page), or use the plan's free week. */
export function boostProduct(product: number, choice: BoostKind | "plan_credit") {
  const body = choice === "plan_credit" ? {product, use_plan_credit: true} : {product, kind: choice};
  return sessionFetch<Partial<SellerGrowth> & {authorization_url?: string}>("/api/seller/boosts/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function buyShopPlan() {
  return sessionFetch<{authorization_url: string; reference: string}>("/api/seller/plan/", {
    method: "POST",
  });
}

export function verifySellerPayment(reference: string) {
  return sessionFetch<SellerGrowth & {status: "pending" | "paid" | "failed"; kind: string}>(
    `/api/seller/payments/${encodeURIComponent(reference)}/verify/`,
    {method: "POST"},
  );
}

export function uploadShopBanner(file: File) {
  const body = new FormData();
  body.append("image", file);
  return sessionFetch<SellerGrowth>("/api/seller/banner/", {method: "PUT", body});
}

export function removeShopBanner() {
  return sessionFetch<SellerGrowth>("/api/seller/banner/", {method: "DELETE"});
}

export function getSellerPayout() {
  return sessionFetch<SellerPayout>("/api/seller/payout/");
}

export function getSellerPayoutBanks() {
  return sessionFetch<{banks: PayoutBank[]}>("/api/seller/payout/banks/");
}

export function saveSellerPayout(body: {bank_code: string; account_number: string; account_name: string}) {
  return sessionFetch<SellerPayout>("/api/seller/payout/", {method: "PUT", body: JSON.stringify(body)});
}

export function stopSellingOnline() {
  return sessionFetch<SellerPayout>("/api/seller/payout/", {method: "DELETE"});
}

export function getSellerOrders() {
  return sessionFetch<{results: MarketplaceOrder[]}>("/api/seller/orders/");
}

export function markOrderHandedOver(reference: string) {
  return sessionFetch<MarketplaceOrder>(`/api/seller/orders/${encodeURIComponent(reference)}/`, {
    method: "PATCH",
    body: JSON.stringify({stage: "delivered"}),
  });
}
