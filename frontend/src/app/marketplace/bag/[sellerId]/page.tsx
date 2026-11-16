import { redirect } from "next/navigation";

/** The old per-seller bag page: it is checkout with that seller now. */
export default async function OldBagPage({ params }: { params: Promise<{ sellerId: string }> }) {
  const { sellerId } = await params;
  redirect(`/marketplace/checkout/${Number(sellerId)}`);
}
