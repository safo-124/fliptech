/** The trade explainer page: /trades/welding. One per trade. */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProviderCard } from "@/components/ProviderCard";
import { ApiError, getTrade, searchProviders } from "@/lib/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ trade: string }>;
}): Promise<Metadata> {
  const { trade } = await params;
  const found = await getTrade(trade).catch(() => null);
  if (!found) return { title: "Not found" };
  return {
    title: `${found.name} training in Ghana`,
    description:
      found.description ||
      `What ${found.name.toLowerCase()} training costs, how long it takes, and where to find it.`,
    alternates: { canonical: `/trades/${trade}` },
  };
}

export default async function TradePage({ params }: { params: Promise<{ trade: string }> }) {
  const { trade } = await params;
  let found;
  try {
    found = await getTrade(trade);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const results = await searchProviders({ trade }).catch(() => null);

  return (
    <div className="px-3 py-4 lg:px-6 lg:py-8">
      <h1 className="text-xl font-bold lg:text-3xl">{found.name} training</h1>
      {found.description && (
        <p className="mt-2 max-w-prose text-sm leading-relaxed lg:text-base">{found.description}</p>
      )}
      <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
        {found.provider_count} listed {found.provider_count === 1 ? "provider" : "providers"}.
      </p>

      <ul className="mt-4 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4 xl:grid-cols-4">
        {results?.results.map((provider) => (
          <li key={provider.id}>
            <ProviderCard provider={provider} />
          </li>
        ))}
      </ul>

      <Link href="/" className="tap mt-4 inline-flex underline">
        Search all trades
      </Link>
    </div>
  );
}
