import { API_URL } from "./config";
import { token } from "./session";
import type {
  SiteSearch,
  BasketPrice,
  Bundle,
  ChatReportReason,
  ChatSummary,
  ChatThread,
  FollowState,
  SavedSearch,
  SellerPayouts,
  SellerProduct,
  ShopDetail,
  CourseAccess,
  CourseCard,
  CourseDetail,
  EnquiryConfirmation,
  MyCourse,
  Order,
  Paginated,
  ProductCard,
  ProductDetail,
  ProviderCard,
  TrainerShop,
  TradeCategory,
  TradeOption,
  WorkshopDetail,
  QuickItemInput,
  CreatedProduct,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The API's words for each field it refused, when it named them. */
    readonly fields: Record<string, string> = {},
    /** The response as sent, for the few callers that need more than words. */
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

type Params = Record<string, string | undefined>;

/** The first message of each field DRF refused: {"phone": "Enter a valid…"}. */
function fieldErrors(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (body && typeof body === "object") {
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") out[key] = value;
      else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
    }
  }
  return out;
}

/**
 * One request to the API, signed in when the app has a token. Errors come
 * back worded for a person: these messages reach the screen as they are.
 */
export async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  {
    params = {},
    body,
    headers: extra = {},
  }: { params?: Params; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  // The header tells the search report a search came from the app.
  const headers: Record<string, string> = { Accept: "application/json", "X-Fliptech-Client": "app", ...extra };
  const signedIn = token();
  if (signedIn) headers.Authorization = `Bearer ${signedIn}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}${query.size ? `?${query}` : ""}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("No connection. Check your data or Wi-Fi and try again.", 0);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const fields = fieldErrors(data);
    const message =
      fields.detail ??
      Object.values(fields)[0] ??
      (response.status >= 500
        ? "Something went wrong on our side. Try again in a minute."
        : "That did not work. Check and try again.");
    throw new ApiError(message, response.status, fields, data);
  }
  return data as T;
}

export function getJson<T>(path: string, params: Params = {}): Promise<T> {
  return request<T>("GET", path, { params });
}

export function postJson<T>(path: string, body: unknown = {}): Promise<T> {
  return request<T>("POST", path, { body });
}

/** Pages the map follows at most: 200 workshops, which covers any one view. */
const MAP_PAGES = 10;

export const api = {
  courses: (params: { q?: string; sort?: string; featured?: string; category?: string } = {}) =>
    getJson<Paginated<CourseCard>>("/api/courses/", params),
  /** The categories for browsing, each saying how much is live in it. */
  tradeCategories: () => getJson<TradeCategory[]>("/api/trade-categories/"),
  products: (params: Record<string, string | undefined> = {}) =>
    getJson<Paginated<ProductCard>>("/api/products/", params),
  trainerShops: () => getJson<{ results: TrainerShop[] }>("/api/sellers/trainers/"),
  providers: (
    params: {
      q?: string;
      trade?: string;
      category?: string;
      area?: string;
      sort?: string;
      lat?: string;
      lng?: string;
      radius_km?: string;
    } = {},
  ) => getJson<Paginated<ProviderCard>>("/api/providers/", params),
  /** Everything matching, a few of each, as the visitor types. log: count it in the report. */
  search: (q: string, options: { lat?: number; lng?: number; log?: boolean } = {}) =>
    getJson<SiteSearch>("/api/search/", {
      q,
      lat: options.lat?.toFixed(3),
      lng: options.lng?.toFixed(3),
      log: options.log ? "1" : undefined,
    }),
  /** "Text me when one opens": needs the app signed in. */
  keepTrainingAlert: (trade: string, area?: string) =>
    postJson<{ id: number }>("/api/search/alerts/", { trade, area: area || undefined }),
  /** Every workshop for the map, following the pages, inside a box if given. */
  async mapProviders(params: { trade?: string; bbox?: string } = {}) {
    const all: ProviderCard[] = [];
    for (let page = 1; page <= MAP_PAGES; page++) {
      const found = await getJson<Paginated<ProviderCard>>("/api/providers/", { ...params, page: String(page) });
      all.push(...found.results);
      if (!found.next) break;
    }
    return all;
  },
  trades: () => getJson<Paginated<TradeOption>>("/api/trades/"),
  workshop: (area: string, slug: string) => getJson<WorkshopDetail>(`/api/providers/${area}/${slug}/`),
  enquire: (body: { phone: string; programme_id: number; intake_id?: number | null; trainee_name: string; message: string }) =>
    postJson<EnquiryConfirmation>("/api/enquiries/", body),

  course: (area: string, slug: string) => getJson<CourseDetail>(`/api/courses/${area}/${slug}/`),
  courseAccess: (area: string, slug: string) => getJson<CourseAccess>(`/api/courses/${area}/${slug}/access/`),
  buyCourse: (area: string, slug: string, code?: string) =>
    postJson<{ authorization_url: string; reference: string }>(`/api/courses/${area}/${slug}/buy/`, code ? { code } : {}),
  verifyCourse: (reference: string) =>
    postJson<{ status: string; owned: boolean }>(`/api/payments/${reference}/verify/`),
  /** Where the learner is, and the stretches played since the last report (lib/played.ts). */
  lessonProgress: (lesson: number, position: number, watched: [number, number][]) =>
    postJson<{ lesson: { completed: boolean }; course: { finished: boolean } }>(
      `/api/learn/lessons/${lesson}/progress/`,
      { position, watched },
    ),
  myCourses: () => getJson<{ results: MyCourse[]; signed_in: boolean }>("/api/learn/mine/"),
  /** Tell staff a lesson video breaks the guidelines. A second report from the same person replaces the first. */
  reportVideo: (video: number, reason: string, note: string) =>
    postJson<{ reported: boolean }>(`/api/videos/${video}/report/`, { reason, note }),

  product: (id: number | string) => getJson<ProductDetail>(`/api/products/${id}/`),
  priceBag: (seller: number, body: BagRequest) => postJson<BasketPrice>(`/api/sellers/${seller}/price/`, body),
  checkout: (seller: number, body: BagRequest & { phone: string; name: string; note?: string }) =>
    postJson<{ authorization_url: string; reference: string }>(`/api/sellers/${seller}/orders/`, body),
  /** "Order from the maker": an order passed to a maker who is paid directly. */
  orderFromMaker: (
    product: number,
    body: {
      phone: string;
      name: string;
      quantity: number;
      option: number | null;
      fulfilment: "pickup" | "delivery";
      note?: string;
    },
  ) => postJson<Order & { conversation_id: number | null }>(`/api/products/${product}/direct-orders/`, body),
  order: (reference: string) => getJson<Order>(`/api/orders/${reference}/`),
  confirmOrder: (reference: string) => postJson<Order>(`/api/orders/${reference}/`),
  myOrders: () => getJson<{ results: Order[] }>("/api/account/orders/"),

  shop: (id: number | string) => getJson<ShopDetail>(`/api/sellers/${id}/`),
  shopBundles: (id: number | string) => getJson<{ results: Bundle[] }>(`/api/sellers/${id}/bundles/`),
  follow: (id: number, on: boolean) => request<FollowState>(on ? "POST" : "DELETE", `/api/sellers/${id}/follow/`),
  followState: (id: number) => getJson<FollowState>(`/api/sellers/${id}/follow/`),

  chats: () => getJson<{ results: ChatSummary[] }>("/api/account/chats/"),
  chat: (id: number | string) => getJson<ChatThread>(`/api/account/chats/${id}/`),
  startChat: (seller: number, body: string, product?: number) =>
    postJson<ChatThread>("/api/account/chats/", { seller, body, ...(product ? { product } : {}) }),
  sendChat: (id: number | string, body: string) => postJson<ChatThread>(`/api/account/chats/${id}/`, { body }),
  /** Share my number: the signed-in person's own phone, into the chat. */
  shareMyNumber: (id: number | string) => postJson<ChatThread>(`/api/account/chats/${id}/share-number/`),
  reportChat: (id: number | string, reason: ChatReportReason, details: string) =>
    postJson<{ detail: string }>(`/api/account/chats/${id}/report/`, { reason, details }),
  /** Block the shop or workshop in this chat (on), or unblock it. */
  blockChat: (id: number | string, on: boolean) =>
    request<ChatThread>(on ? "POST" : "DELETE", `/api/account/chats/${id}/block/`),

  /** The business inbox: every chat for the shop and the workshop this login holds. */
  inbox: () => getJson<{ results: ChatSummary[] }>("/api/inbox/"),
  inboxChat: (id: number | string) => getJson<ChatThread>(`/api/inbox/${id}/`),
  sendInboxChat: (id: number | string, body: string) => postJson<ChatThread>(`/api/inbox/${id}/`, { body }),
  shareInboxNumber: (id: number | string) => postJson<ChatThread>(`/api/inbox/${id}/share-number/`),
  reportInboxChat: (id: number | string, reason: ChatReportReason, details: string) =>
    postJson<{ detail: string }>(`/api/inbox/${id}/report/`, { reason, details }),
  /** Block the person in this chat (on), or unblock them, for the whole shop or workshop. */
  blockInboxChat: (id: number | string, on: boolean) =>
    request<ChatThread>(on ? "POST" : "DELETE", `/api/inbox/${id}/block/`),
  /** A seller opening the chat with a paid order's buyer, to write first. */
  openOrderChat: (reference: string) => postJson<ChatThread>("/api/inbox/", { order: reference }),

  savedSearches: () => getJson<{ results: SavedSearch[] }>("/api/account/searches/"),
  saveSearch: (params: Record<string, string>, label: string) =>
    postJson<SavedSearch>("/api/account/searches/", { params, label }),
  deleteSearch: (id: number) => request<void>("DELETE", `/api/account/searches/${id}/`),

  addresses: () => getJson<{ results: { id: number; label: string; address: string }[] }>("/api/account/addresses/"),
  received: (reference: string) => postJson<Order>(`/api/orders/${reference}/received/`),
  reportProblem: (reference: string, problem: string) =>
    postJson<Order>(`/api/orders/${reference}/problem/`, { problem }),
  sellerPayouts: () => getJson<SellerPayouts>("/api/seller/payouts/"),
  /** A seller's paid orders, newest first. */
  sellerOrders: () => getJson<{ results: Order[] }>("/api/seller/orders/"),
  /** "delivered" (handed over) or "ready" (made to order: asks for the balance). */
  sellerOrderStage: (reference: string, stage: "delivered" | "ready") =>
    request<Order>("PATCH", `/api/seller/orders/${reference}/`, { body: { stage } }),
  /** "Text me when it is back", for a sold-out product. */
  stockAlert: (product: number, phone: string) =>
    postJson<{ detail: string }>(`/api/products/${product}/notify/`, { phone }),
  sellerProducts: () => getJson<SellerProduct[] | { results: SellerProduct[] }>("/api/seller/products/"),
  updateSellerProduct: (id: number, body: Partial<Pick<SellerProduct, "availability" | "stock" | "price">>) =>
    request<SellerProduct>("PATCH", `/api/seller/products/${id}/`, { body }),
  /** "Add an item": the item, its waiting photos, sizes, and whether to put it on sale. */
  createSellerProduct: (body: QuickItemInput) => postJson<CreatedProduct>("/api/seller/products/", body),
  removePendingPhoto: (id: number) => request<void>("DELETE", `/api/seller/photos/${id}/`),
  /** The shop, for its workshop's trade (the new item's default). */
  sellerAccount: () => getJson<{ workshop: { trade_id: number | null } | null }>("/api/seller/account/"),
  sellerId: () => getJson<{ status: string; status_label: string; level: string; takes_payments: boolean; note: string }>("/api/seller/id/"),
  courseTools: (area: string, slug: string) =>
    getJson<{ chosen: boolean; tools: string[]; products: ProductCard[] }>(`/api/courses/${area}/${slug}/tools/`),
  courseBundles: (area: string, slug: string) => getJson<{ results: Bundle[] }>(`/api/courses/${area}/${slug}/bundles/`),
  bundle: (id: number | string) => getJson<Bundle>(`/api/bundles/${id}/`),
  buyBundle: (id: number, body: { phone: string; name: string; fulfilment: "pickup" | "delivery"; note?: string }) =>
    postJson<{ authorization_url: string; reference: string }>(`/api/bundles/${id}/orders/`, body),
};

export type BagRequest = {
  items: { product: number; option: number | null; quantity: number }[];
  fulfilment: "pickup" | "delivery";
  code?: string;
  pay_at_collection?: boolean;
};

/**
 * Upload a photo for an item not saved yet, reporting progress (0 to 1).
 * XMLHttpRequest, not fetch: only it reports upload progress.
 */
export function uploadPendingPhoto(
  uri: string,
  mimeType = "image/jpeg",
  onProgress?: (share: number) => void,
): Promise<{ id: number; image: string | null }> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    const ext = mimeType.split("/")[1] || "jpg";
    body.append("image", { uri, name: `item.${ext}`, type: mimeType } as unknown as Blob);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/seller/photos/`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-Fliptech-Client", "app");
    const signedIn = token();
    if (signedIn) xhr.setRequestHeader("Authorization", `Bearer ${signedIn}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // A proxy's error page, not JSON.
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data as { id: number; image: string | null });
      else reject(new ApiError(fieldErrors(data).detail ?? "That photo did not upload.", xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("No connection. Check your data or Wi-Fi and try again.", 0));
    xhr.send(body);
  });
}

/**
 * Set the signed-in account's photo from a picture on the phone. Multipart,
 * so not through `request` (which sends JSON). Returns the account as the
 * server now has it, to put straight into the ["account"] query.
 */
export async function uploadAccountPhoto(uri: string, mimeType = "image/jpeg") {
  const body = new FormData();
  const ext = mimeType.split("/")[1] || "jpg";
  body.append("photo", { uri, name: `photo.${ext}`, type: mimeType } as unknown as Blob);
  const headers: Record<string, string> = { Accept: "application/json", "X-Fliptech-Client": "app" };
  const signedIn = token();
  if (signedIn) headers.Authorization = `Bearer ${signedIn}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/account/photo/`, { method: "POST", headers, body });
  } catch {
    throw new ApiError("No connection. Check your data or Wi-Fi and try again.", 0);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const fields = fieldErrors(data);
    throw new ApiError(fields.detail ?? "That photo did not upload. Try another.", response.status, fields);
  }
  return data;
}
