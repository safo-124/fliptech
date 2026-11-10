import { appPath } from "./links";

describe("appPath", () => {
  it("opens the app's own screen for the site's pages", () => {
    expect(appPath("/account/chats/12")).toBe("/chats/12");
    expect(appPath("/sell/shop?tab=orders")).toBe("/seller/orders");
    expect(appPath("/sell/shop?tab=chats")).toBe("/seller/chats");
    expect(appPath("/marketplace/order/M-ABC")).toBe("/order/M-ABC");
    expect(appPath("/marketplace/42")).toBe("/product/42");
    expect(appPath("/marketplace/seller/7")).toBe("/shop/7");
    expect(appPath("/learn/tema/tema-tailoring")).toBe("/course/tema/tema-tailoring");
    expect(appPath("/tema/tema-welding-centre")).toBe("/workshop/tema/tema-welding-centre");
    expect(appPath("/training?trade=welding&area=tema&page=2")).toBe("/explore?trade=welding&area=tema");
    expect(appPath("/marketplace?q=bags")).toBe("/search?q=bags");
    expect(appPath("/")).toBe("/");
  });

  it("opens anything else on the website, inside the app", () => {
    expect(appPath("/privacy")).toBe("/web?path=%2Fprivacy");
    expect(appPath("/trainer/join?new=1")).toBe("/web?path=%2Ftrainer%2Fjoin%3Fnew%3D1");
  });
});
