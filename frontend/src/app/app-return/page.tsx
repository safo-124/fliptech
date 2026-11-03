/**
 * /app-return: where Paystack sends someone who paid from the mobile app.
 *
 * The backend points a payment started in the app here (backend
 * accounts/app_auth.py, payment_return); Paystack adds the payment's
 * reference to the address. This hands it straight back to the app, which
 * confirms the payment itself. Nothing is decided here: it is a door.
 */

import type { Metadata } from "next";

import { BackToApp } from "./BackToApp";

export const metadata: Metadata = {
  title: "Back to the app",
  robots: { index: false, follow: false },
};

export default async function AppReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const pick = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const reference = (pick("reference") || pick("trxref")).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  const target = `fliiptech://paid${reference ? `?reference=${reference}` : ""}`;
  return <BackToApp target={target} />;
}
