import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Loaded here, before any test's clock starts: the first render of a screen
// through the router is slow on a cold CI runner.
import BasketScreen from "../../app/basket";
import CheckoutScreen from "../../app/checkout";

// Rendering through the router takes a few seconds on a cold CI runner.
jest.setTimeout(20_000);


const metrics = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

// ---------------------------------------------------------------- mocks

jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: MockView };
});

const mockCheckout = jest.fn();
const mockSetQuantity = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
let mockBasket: unknown;

jest.mock("@/lib/basket", () => {
  const actual = jest.requireActual("@/lib/basket");
  return {
    ...actual,
    useBasket: () => ({
      basket: mockBasket,
      count: 3,
      loading: false,
      refresh: mockRefresh,
      add: jest.fn(),
      setQuantity: mockSetQuantity,
      remove: jest.fn(),
      clear: jest.fn(),
      checkout: mockCheckout,
    }),
  };
});

jest.mock("@/lib/auth", () => ({
  useAuth: () => ({
    ready: true,
    signedIn: true,
    account: { phone: "+233241234567", display_name: "Esi", delivery_address: "" },
    roles: null,
    requestCode: jest.fn(),
    verifyCode: jest.fn(),
  }),
}));

const mockPriceBag = jest.fn();
const mockConfirmOrder = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      priceBag: (...args: unknown[]) => mockPriceBag(...args),
      confirmOrder: (...args: unknown[]) => mockConfirmOrder(...args),
    },
  };
});

const mockPay = jest.fn(async (_url: string) => true);
jest.mock("@/lib/pay", () => ({ payOnPaystack: (url: string) => mockPay(url) }));

// --------------------------------------------------------------- fixtures

const seller = (id: number, name: string) => ({
  id,
  business_name: name,
  about: "",
  area: "Kumasi",
  region: "Ashanti",
  workshop: null,
  rating: null,
  verified: true,
  replies_fast: false,
  delivery_fee: null,
  delivery_area: "",
  student_discount: null,
  away_until: null,
  away_note: "",
});

const line = (over: Record<string, unknown> = {}) => ({
  id: 1,
  product: 11,
  option: null,
  option_label: "",
  name: "Black soap",
  photo: null,
  unit_price: "40.00",
  quantity: 2,
  max_quantity: 3,
  few_left: 3,
  line_total: "80.00",
  available: true,
  unavailable_reason: "",
  made_to_order: null,
  price_changed: null,
  ...over,
});

const totals = (total: string, plan = "full") => ({
  subtotal: total,
  discount: "0.00",
  delivery: "0.00",
  total,
  pay_now: plan === "direct" ? "0.00" : total,
  balance: "0.00",
  plan,
});

const BASKET = {
  token: null,
  owner: "account",
  count: 3,
  notice: "",
  groups: [
    {
      seller: seller(6, "Akua's Soaps"),
      pickup: null,
      delivery: null,
      takes_payments: true,
      lines: [line(), line({ id: 2, product: 12, name: "Old shea butter", available: false, line_total: null })],
      subtotal: "80.00",
      total: "80.00",
      totals: { pickup: totals("80.00"), delivery: null },
      problem: "",
    },
    {
      seller: seller(2, "Accra Welding"),
      pickup: null,
      delivery: null,
      takes_payments: false,
      lines: [line({ id: 3, product: 16, name: "Shoe rack", quantity: 1, few_left: null, max_quantity: 20, unit_price: "1350.00", line_total: "1350.00" })],
      subtotal: "1350.00",
      total: "1350.00",
      totals: { pickup: totals("1350.00", "direct"), delivery: null },
      problem: "",
    },
  ],
};

let client = new QueryClient();

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>
        <Slot />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockBasket = BASKET;
  jest.clearAllMocks();
});

// ------------------------------------------------------------------ tests

describe("the basket screen", () => {
  it("shows the lines by seller with the right button for each", async () => {
    await renderRouter({ _layout: Layout, index: BasketScreen });

    expect(await screen.findByText("Akua's Soaps")).toBeTruthy();
    expect(screen.getByText("Accra Welding")).toBeTruthy();
    expect(screen.getByText("Pay GH₵80 with MoMo or card")).toBeTruthy();
    expect(screen.getByText("Send order to Accra Welding")).toBeTruthy();
    expect(screen.getByText("Only 3 left")).toBeTruthy();
    expect(screen.getByText("No longer available")).toBeTruthy();
    expect(
      screen.getByText(
        "This maker takes payment directly. We send them your order and you agree payment and pickup in the chat.",
      ),
    ).toBeTruthy();
  });

  it("changes a quantity through the server", async () => {
    mockSetQuantity.mockResolvedValue(BASKET);
    await renderRouter({ _layout: Layout, index: BasketScreen });

    const first = await screen.findByTestId("basket-line-1");
    const more = screen.getAllByLabelText("One more")[0];
    await act(async () => {
      fireEvent.press(more);
    });

    expect(first).toBeTruthy();
    expect(mockSetQuantity).toHaveBeenCalledWith(1, 3);
  });

  it("says when the basket is empty", async () => {
    mockBasket = { ...BASKET, count: 0, groups: [] };
    await renderRouter({ _layout: Layout, index: BasketScreen });

    expect(await screen.findByText("Your basket is empty")).toBeTruthy();
  });
});

describe("checking out", () => {
  it("pays a seller who takes payments: no code for the buyer's own number, then Paystack", async () => {
    mockPriceBag.mockResolvedValue({
      lines: [{ product: 11, product_name: "Black soap", option: null, option_label: "", unit_price: "40.00", quantity: 2, total: "80.00" }],
      subtotal: "80.00",
      discount: "0.00",
      code: "",
      delivery: "0.00",
      delivery_fee: null,
      delivery_area: "",
      total: "80.00",
      protected: true,
      plan: "full",
      deposit_percent: null,
      pay_now: "80.00",
      balance: "0.00",
    });
    mockCheckout.mockResolvedValue({ kind: "pay", authorization_url: "https://paystack.test/x", reference: "fo-1" });
    mockConfirmOrder.mockResolvedValue({ reference: "fo-1", status: "paid" });
    await renderRouter(
      { _layout: Layout, checkout: CheckoutScreen, "order/[reference]": () => <View testID="order-page" /> },
      { initialUrl: "/checkout?seller=6" },
    );

    const pay = await screen.findByText("Pay GH₵80 with MoMo or card");
    await act(async () => {
      fireEvent.press(pay);
    });

    await waitFor(() => expect(mockConfirmOrder).toHaveBeenCalledWith("fo-1"));
    expect(mockCheckout).toHaveBeenCalledWith(6, {
      phone: "+233241234567",
      name: "Esi",
      fulfilment: "pickup",
      note: undefined,
    });
    expect(mockPay).toHaveBeenCalledWith("https://paystack.test/x");
    expect(await screen.findByTestId("order-page")).toBeTruthy();
  });

  it("sends the order to a maker paid directly", async () => {
    mockCheckout.mockResolvedValue({ kind: "direct", reference: "fd-1", conversation_id: 9 });
    await renderRouter(
      { _layout: Layout, checkout: CheckoutScreen, "order/[reference]": () => <View testID="order-page" /> },
      { initialUrl: "/checkout?seller=2" },
    );

    const send = await screen.findByText("Send order to Accra Welding");
    await act(async () => {
      fireEvent.press(send);
    });

    expect(mockCheckout).toHaveBeenCalledWith(2, expect.objectContaining({ phone: "+233241234567", name: "Esi" }));
    expect(mockPay).not.toHaveBeenCalled();
    expect(await screen.findByTestId("order-page")).toBeTruthy();
  });
});
