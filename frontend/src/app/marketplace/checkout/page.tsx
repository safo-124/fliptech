import { redirect } from "next/navigation";

/** The old "check out everything" page: the basket shows every seller now. */
export default function OldCheckoutPage() {
  redirect("/marketplace/basket");
}
