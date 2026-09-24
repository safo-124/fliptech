"use client";

import {Clock3, MessageCircle, Phone, Search, Send} from "lucide-react";
import {useState} from "react";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Skeleton} from "@/components/ui/skeleton";
import {formatDate} from "@/lib/format";
import {matchesQuery} from "@/lib/trainee-progress";
import {cn} from "@/lib/utils";
import type {TrainerEnquiry} from "@/lib/types";

type Filter = "all" | "waiting" | "replied";

/**
 * The people who asked, and a way to answer them.
 *
 * The dashboard has always counted enquiries. It never showed them: the API
 * endpoint existed and nothing called it, so an owner was told "seven people
 * asked about your courses" and given no way to find out who, or to reply.
 * That is most of the product loop missing from the one screen the workshop
 * owner actually opens.
 *
 * Replying is a wa.me link rather than anything in-app. It is free, it lands
 * in the app both sides already use, and it carries the reference so the
 * conversation can be tied back to this row later.
 */
export function TrainerEnquiries({
  enquiries,
  loading,
}: {
  enquiries: TrainerEnquiry[];
  loading: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-busy="true">
        <span className="sr-only">Loading your enquiries…</span>
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-36 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (enquiries.length === 0) {
    return (
      <Card className="border-dashed p-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
          <Send aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-4 text-lg font-semibold">No enquiries yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-[var(--color-muted-foreground)]">
          When someone asks about your courses through Skills Hub, they appear here with their
          message and a reference, and you can reply on WhatsApp.
        </p>
      </Card>
    );
  }

  const waiting = enquiries.filter((enquiry) => !enquiry.replied).length;
  const counts: Record<Filter, number> = {
    all: enquiries.length,
    waiting,
    replied: enquiries.length - waiting,
  };
  const visible = enquiries.filter(
    (enquiry) =>
      (filter === "all" ||
        (filter === "waiting" && !enquiry.replied) ||
        (filter === "replied" && enquiry.replied)) &&
      matchesQuery(
        query,
        enquiry.trainee_name,
        enquiry.trainee_phone,
        enquiry.programme,
        enquiry.reference_code,
        enquiry.message,
      ),
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
        />
        <Input
          type="search"
          aria-label="Search your enquiries"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, number, course or reference"
          className="pl-9"
        />
      </div>

      <div className="flex gap-1.5" role="group" aria-label="Filter enquiries">
        {(
          [
            ["waiting", "Needs a reply"],
            ["all", "All"],
            ["replied", "Replied"],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              filter === key
                ? "border-transparent bg-[var(--color-brand)] text-white"
                : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:border-[var(--color-border-strong)]",
            )}
          >
            {label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[key]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card className="border-dashed p-6 text-center">
          <p className="font-semibold">Nothing matches</p>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Try a different word, or clear the filter.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mx-auto mt-4"
            onClick={() => {
              setFilter("all");
              setQuery("");
            }}
          >
            Clear filters
          </Button>
        </Card>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {visible.map((enquiry) => (
            <li key={enquiry.reference_code}>
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {enquiry.replied ? (
                      <Badge variant="secondary">Replied</Badge>
                    ) : (
                      <Badge variant="warning">
                        <Clock3 aria-hidden="true" />
                        Needs a reply
                      </Badge>
                    )}
                    <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                      {enquiry.reference_code}
                    </span>
                  </div>
                  <CardTitle className="text-lg">
                    {enquiry.trainee_name || "Someone"}
                  </CardTitle>
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {enquiry.programme ?? "General enquiry"} · asked{" "}
                    {formatDate(enquiry.created_at)}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {enquiry.message ? (
                    <p className="rounded-xl bg-[var(--color-muted)]/70 p-3 leading-6">
                      “{enquiry.message}”
                    </p>
                  ) : (
                    <p className="text-[var(--color-muted-foreground)]">
                      They did not leave a message.
                    </p>
                  )}
                  <p className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                    <Phone aria-hidden="true" className="size-4" />
                    {enquiry.trainee_phone}
                  </p>
                  <Button asChild variant="brand" className="w-full">
                    <a href={enquiry.whatsapp_url} target="_blank" rel="noopener noreferrer">
                      <MessageCircle aria-hidden="true" />
                      Reply on WhatsApp
                    </a>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
