/**
 * The published privacy policy Section 10 requires.
 *
 * Written against what the code actually does, not from a template. Every
 * claim here was checked against the models and settings, and the awkward ones
 * are stated rather than smoothed over — that a phone number survives an
 * erasure request on the workshop's enquiry record, that the server is in
 * Finland, that no retention schedule runs automatically yet. A policy that
 * describes a system nobody built is worse than no policy, because it is a
 * promise on paper that the software breaks every day.
 *
 * If you change what is collected, change this page in the same commit.
 */

import type {Metadata} from "next";
import Link from "next/link";
import {Database, Eye, LockKeyhole, ShieldCheck, Trash2} from "lucide-react";

import {BrandShards} from "@/components/BrandShards";
import {BRAND} from "@/lib/brand";

// ---------------------------------------------------------------------------
// TODO BEFORE PUBLISHING: replace with a real, monitored address.
// A privacy policy is a promise that someone answers. Until this is a working
// route to a person, the page below tells the reader so rather than printing a
// placeholder as if it were real.
// ---------------------------------------------------------------------------
const DATA_CONTACT = "";

/** The registration Section 10 lists as required, and which is not yet done. */
const DPC_REGISTERED = false;

const LAST_UPDATED = "16 September 2026";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${BRAND} Skills Hub collects, uses and protects your personal information.`,
};

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      <h2 id={id} className="text-xl font-bold tracking-tight sm:text-2xl">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-[var(--color-foreground)]/85 sm:text-base">
        {children}
      </div>
    </section>
  );
}

function DataTable({rows}: {rows: [string, string][]}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map(([what, why], index) => (
            <tr
              key={what}
              className={index > 0 ? "border-t border-[var(--color-border)]" : undefined}
            >
              <th scope="row" className="w-2/5 bg-[var(--color-muted)]/40 p-3 align-top font-semibold">
                {what}
              </th>
              <td className="p-3 align-top leading-6">{why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <section className="band relative isolate overflow-hidden">
        <BrandShards className="pointer-events-none absolute -bottom-10 right-0 h-[14rem] w-[18rem] opacity-40" />
        <div className="app-shell relative z-10 py-10 sm:py-14">
          <span className="badge border-white/20 bg-white/10 text-white/80 backdrop-blur-sm">
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            Your information
          </span>
          <h1 className="mt-4 max-w-3xl text-3xl font-bold leading-[1.1] tracking-[-0.03em] text-white sm:text-4xl">
            Privacy policy
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
            What {BRAND} Skills Hub collects, who can see it, and how to get it removed.
            Last updated {LAST_UPDATED}.
          </p>
        </div>
      </section>

      <div className="app-shell max-w-3xl space-y-10 py-10 sm:py-14">
        {DATA_CONTACT ? null : (
          <div
            role="alert"
            className="rounded-2xl border border-[var(--color-warn)]/30 bg-[var(--color-warn-bg)] p-4 text-sm leading-6"
          >
            <p className="font-semibold text-[var(--color-warn)]">
              This policy is not finished.
            </p>
            <p className="mt-1">
              A contact address for data requests has not been set yet, so there is no way to
              act on the rights described below. Do not treat this page as final until it is.
            </p>
          </div>
        )}

        <Section id="who-we-are" title="Who we are">
          <p>
            Skills Hub is run by {BRAND} Engineering Solutions. It helps people in Greater
            Accra find practical skills training, and helps small workshops get found.
          </p>
          <p>
            We are the data controller for the information described here. Ghana&apos;s Data
            Protection Act, 2012 (Act 843) governs how we handle it.
          </p>
          {DPC_REGISTERED ? null : (
            <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-sm">
              <strong>Registration status:</strong> our registration with the Data Protection
              Commission is in progress and is not yet complete. We are telling you because
              the alternative is saying nothing and hoping nobody checks.
            </p>
          )}
        </Section>

        <Section id="what-we-collect" title="What we collect">
          <p className="flex items-start gap-2">
            <Eye aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--color-brand)]" />
            <span>
              <strong>If you only browse and search, we collect nothing that identifies
              you.</strong> There are no analytics, advertising or tracking cookies anywhere on
              this site. You can compare every provider, fee and intake date without telling
              us who you are.
            </span>
          </p>

          <h3 className="pt-2 font-semibold">If you send an enquiry to a workshop</h3>
          <DataTable
            rows={[
              ["Your phone number", "So the workshop can reply, and so we can confirm the number is real"],
              ["The course and intake you chose", "So the workshop knows what you are asking about"],
              ["Your name and message", "Both optional. Whatever you choose to type"],
              ["A reference code", "So you can quote it on the phone"],
            ]}
          />

          <h3 className="pt-2 font-semibold">If you create a free trainee account</h3>
          <DataTable
            rows={[
              ["Your phone number", "It is how you sign in. There is no password"],
              ["A display name", "Optional. How workshops should address you"],
              ["WhatsApp or Telegram preference", "Where you would rather be contacted"],
              [
                "Your education background",
                "Entirely optional: school level, which school, what you studied, how far you got and in which year. It helps us suggest training that suits you. Leaving it blank changes nothing about what you can see or do",
              ],
              ["Your enquiries, enrolments and saved workshops", "So you can find them again"],
            ]}
          />

          <h3 className="pt-2 font-semibold">If you list a workshop</h3>
          <DataTable
            rows={[
              ["Your name, role and phone number", "So we know who is responsible for the listing"],
              [
                "Your ID type, number and a photograph of it",
                "So we can check a real person runs a real workshop before it goes live. See “What stays private” below",
              ],
              [
                "The workshop details",
                "Name, owner, contact number, address, landmark, location, courses, fees and intake dates. Most of this becomes your public listing",
              ],
              ["Photographs of the workshop", "These are published on your listing"],
              [
                "What you agreed to, and when",
                "That your fees and dates were accurate, that we may visit, and that we may hold your details",
              ],
            ]}
          />

          <h3 className="pt-2 font-semibold">Technical records</h3>
          <DataTable
            rows={[
              [
                "One-time code records",
                "The code itself is stored scrambled, never in plain text. We keep the time it was sent, whether it worked, and the internet address that asked for it — this is what stops someone running up an SMS bill on your number",
              ],
              [
                "Sign-in cookies",
                "A session cookie your browser cannot read from JavaScript, and a security cookie that prevents other websites acting as you. Nothing else",
              ],
              ["Server logs", "Ordinary web server records of requests, kept for troubleshooting"],
            ]}
          />
        </Section>

        <Section id="never" title="What we never collect">
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <LockKeyhole aria-hidden="true" className="mt-1.5 size-3.5 shrink-0" />
              <span>
                <strong>Identity documents from trainees.</strong> We ask workshop owners for
                ID because they are being listed publicly and vouched for. We never ask a
                trainee for one.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <LockKeyhole aria-hidden="true" className="mt-1.5 size-3.5 shrink-0" />
              <span>
                <strong>Payment details.</strong> Course fees are paid to the workshop
                directly. We do not take payments, so we hold no card or mobile money details.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <LockKeyhole aria-hidden="true" className="mt-1.5 size-3.5 shrink-0" />
              <span>
                <strong>Your location.</strong> If you search near you, your device works out
                the distance. We do not store where you were.
              </span>
            </li>
          </ul>
        </Section>

        <Section id="who-sees" title="Who can see what">
          <DataTable
            rows={[
              [
                "Public, to anyone",
                "Approved workshop listings and their photographs: name, address, courses, fees, intake dates, and what we checked",
              ],
              [
                "The workshop you enquired with",
                "Your phone number, the course you asked about, and your name and message if you gave them",
              ],
              [
                "Never public",
                "Identity documents, verification evidence, trainee phone numbers, enquiry messages, and anything about your education",
              ],
              [
                "Our staff",
                "Only what their role allows. A staff member can open your trainee dashboard to help you, but only through a session that is logged, recorded against their name, and expires by itself after thirty minutes",
              ],
            ]}
          />
          <p>
            Identity documents and verification evidence are kept in storage the web server
            cannot reach at all. There is no address that serves them, even to someone who
            guesses one.
          </p>
        </Section>

        <Section id="where" title="Where your information is kept">
          <p className="flex items-start gap-2">
            <Database aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--color-brand)]" />
            <span>
              Our server is in Finland, inside the European Union. That means your information
              leaves Ghana. We use European hosting because it is more reliable and cheaper
              than the alternatives, and the European Union has data protection rules at least
              as strict as Ghana&apos;s — but you should know where your details actually sit.
            </span>
          </p>
        </Section>

        <Section id="others" title="Who else handles it">
          <p>We share as little as possible, and only to make something work that you asked for.</p>
          <DataTable
            rows={[
              [
                "An SMS provider",
                "Receives your phone number in order to send you a one-time code. Nothing else",
              ],
              [
                "WhatsApp (Meta)",
                "When you continue an enquiry on WhatsApp, that conversation happens on WhatsApp and is covered by their terms, not ours. We do this deliberately rather than building a chat nobody would install an app for",
              ],
              [
                "Photograph storage",
                "Workshop photographs may be stored with a cloud storage provider. They are public content either way",
              ],
              [
                "Error monitoring",
                "If enabled, it is configured not to send personal information — no phone numbers, no names",
              ],
            ]}
          />
          <p>
            We do not sell your information, and we do not share it for advertising. Search
            results are ordered by distance, never by who paid us.
          </p>
        </Section>

        <Section id="how-long" title="How long we keep it">
          <p>
            Your trainee account and its history stay until you close it. Workshop listings
            stay while they are listed with us.
          </p>
          <p>
            We should be straight with you about one thing: we do not yet delete old records
            automatically on a fixed schedule. Removing your information today depends on you
            asking us, and on us acting on it — which we will. Setting proper retention
            periods is work we have not finished.
          </p>
        </Section>

        <Section id="your-rights" title="Your rights, and what actually happens">
          <p>
            Under Act 843 you can ask to see what we hold about you, correct it, or have it
            deleted. Two things are worth explaining plainly, because they are not the same.
          </p>

          <h3 className="pt-2 font-semibold">Closing your account</h3>
          <p className="flex items-start gap-2">
            <Trash2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--color-brand)]" />
            <span>
              You can do this yourself from your account page. Your account, your sign-in and
              your saved workshops are deleted. Enquiries and enrolments stay with the
              workshop you sent them to, no longer linked to you — they are that workshop&apos;s
              business record as well as yours.
            </span>
          </p>

          <h3 className="pt-2 font-semibold">Asking us to erase your personal data</h3>
          <p>
            This goes further. On top of closing the account, we remove your name and anything
            you wrote from every enquiry and enrolment on your number, and delete the
            verification-code log for it.
          </p>
          <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3">
            <strong>What we cannot remove on our own:</strong> your phone number stays on the
            enquiry and enrolment records held by the workshops you contacted, because those
            are their records too. If you want it gone from those, tell us and we will work
            through it with you rather than pretend a button solves it.
          </p>
        </Section>

        <Section id="security" title="Keeping it safe">
          <p>
            The site is served only over an encrypted connection. Sign-in cookies cannot be
            read by JavaScript. One-time codes are stored scrambled and expire in minutes.
            Repeated wrong passwords lock an account out. Identity documents sit outside the
            area the web server can serve from at all.
          </p>
          <p>
            No system is perfect. If you think something has gone wrong with your information,
            tell us and we will look.
          </p>
        </Section>

        <Section id="contact" title="Contacting us">
          {DATA_CONTACT ? (
            <p>
              For any request about your information — to see it, correct it or delete it —
              contact <strong>{DATA_CONTACT}</strong>. Tell us the phone number you used, so
              we can find your records.
            </p>
          ) : (
            <p className="rounded-xl border border-[var(--color-warn)]/30 bg-[var(--color-warn-bg)] p-3">
              A contact address for data requests has not been published yet. Until it is,
              this policy describes rights you have no practical way to exercise, which we do
              not consider acceptable and are fixing.
            </p>
          )}
          <p>
            If you are not satisfied with how we answer, you can complain to Ghana&apos;s Data
            Protection Commission.
          </p>
        </Section>

        <Section id="changes" title="Changes to this policy">
          <p>
            If we start collecting something new, we will change this page and update the date
            at the top. This policy was last updated on {LAST_UPDATED}.
          </p>
        </Section>

        <div className="border-t border-[var(--color-border)] pt-6">
          <Link
            href="/"
            className="text-sm font-semibold text-[var(--color-brand)] hover:underline"
          >
            Back to finding training
          </Link>
        </div>
      </div>
    </>
  );
}
