import { redirect } from "next/navigation";

/** One seller's own checkout, from before one payment covered the basket:
    every purchase now goes through /marketplace/checkout. */
export default function OldSellerCheckout() {
  redirect("/marketplace/checkout");
}
