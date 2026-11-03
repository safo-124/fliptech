import { API_URL } from "./config";
import { token } from "./session";
import type {
  BasketPrice,
  Bundle,
  ChatSummary,
  ChatThread,
  FollowState,
  SavedSearch,
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
  TradeOption,
  WorkshopDetail,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The API's words for each field it refused, when it named them. */
    readonly fields: Record<string, string> = {},
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
  { params = {}, body }: { params?: Params; body?: unknown } = {},
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const headers: Record<string, string> = { Accept: "application/json" };
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
    throw new ApiError(message, response.status, fields);
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
  courses: (params: { q?: string; sort?: string; featured?: string } = {}) =>
    getJson<Paginated<CourseCard>>("/api/courses/", params),
  products: (params: Record<string, string | undefined> = {}) =>
    getJson<Paginated<ProductCard>>("/api/products/", params),
  trainerShops: () => getJson<{ results: TrainerShop[] }>("/api/sellers/trainers/"),
  providers: (params: { q?: string; trade?: string } = {}) =>
    getJson<Paginated<ProviderCard>>("/api/providers/", params),
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
  lessonProgress: (lesson: number, position: number, completed = false) =>
    postJson<{ certificate: unknown }>(`/api/learn/lessons/${lesson}/progress/`, { position, completed }),
  myCourses: () => getJson<{ results: MyCourse[]; signed_in: boolean }>("/api/learn/mine/"),

  product: (id: number | string) => getJson<ProductDetail>(`/api/products/${id}/`),
  priceBag: (seller: number, body: BagRequest) => postJson<BasketPrice>(`/api/sellers/${seller}/price/`, body),
  checkout: (seller: number, body: BagRequest & { phone: string; name: string; note?: string }) =>
    postJson<{ authorization_url: string; reference: string }>(`/api/sellers/${seller}/orders/`, body),
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

  savedSearches: () => getJson<{ results: SavedSearch[] }>("/api/account/searches/"),
  saveSearch: (params: Record<string, string>, label: string) =>
    postJson<SavedSearch>("/api/account/searches/", { params, label }),
  deleteSearch: (id: number) => request<void>("DELETE", `/api/account/searches/${id}/`),

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
};
