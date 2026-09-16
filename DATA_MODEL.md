# Fliiptech Skills Hub — revised data model

Corrections to Section 07 of *Fliiptech Skills Hub Product Documentation v1.0*.

The PDF specifies nine tables. Six are correct as written. Three changes are
structural and should be made before the first migration, because each one is
either irrecoverable later or blocks a screen that Section 04 already promises.

**Nine tables becomes sixteen.** Six of the seven additions are small join or log
tables that cost an hour each now and a data migration later.

---

## What changed, and why

### 1. `Enrolment` — new table. This is the important one.

The PDF hangs *completion* and *provider attestation* off `EnquiryOutcome`, and
Section 08 correctly argues those two fields are the entire foundation of
employer matching and cannot be reconstructed retrospectively.

But Section 12 accepts **leakage** as a fact of the business: a trainee finds a
workshop, calls the number directly, and the platform never sees the enrolment.
That is the stated reason revenue rests on subscriptions rather than transaction
fees.

Both statements are true, and together they break the model. If completion hangs
off `EnquiryOutcome`, then the graduate record only ever contains trainees who
came through a platform enquiry — the minority, by the document's own admission.
Section 08 would arrive at year two with a graduate population a fraction of the
real one, which is precisely the outcome Section 08 exists to prevent.

**Fix:** `Enrolment` stands on its own, keyed to Provider + Programme + Intake,
with an *optional* FK to `Enquiry`. Completion and attestation live here. The
field officer's monthly conversation already covers every enrolment at that
workshop, not just the attributed ones — so this costs nothing extra to collect
and captures several times the data.

`EnquiryOutcome` stays, but shrinks to what it can honestly observe: replied,
visited, enrolled. Attribution becomes a nullable link rather than a precondition.

### 2. `Region` and `Area` — new tables

Section 04 specifies URLs of the form `/greater-accra/welding-training` and
`/tema/welding-training`, and the Screen 1 filter bar filters by area. The nine
tables have no place to put an area — only an address string on `Provider`.
Those pages cannot be generated, and that filter cannot be built, without a
slugged geographic table.

`Area` also carries a centroid point, which gives the radius search a sensible
default origin when a trainee declines the browser location prompt.

### 3. `ProviderPhoto` and `ProviderEvidence` — two new tables

The PDF lists "photographs" as a field on `Provider`. But Section 10 requires
two incompatible things of provider images: workshop photographs are public
content served through a CDN, while verification evidence and owner
identification are private and "never publicly served".

Those need different buckets, different ACLs and different URL strategies
(public CDN URL vs. short-lived signed URL). A single field cannot express it,
and a mistake here is the kind you cannot un-leak.

**Revised during implementation.** This was originally specified as one
`ProviderMedia` table with a `visibility` flag. That does not work: Django binds
storage at the *field*, not the instance, so one `FileField` cannot route to two
buckets per row. A callable `storage=` is evaluated once when the field is
constructed, not per record.

Splitting into two models is also the safer answer, so this is not a reluctant
workaround. With a visibility flag, a single mis-set boolean leaks an identity
document. With two models bound to two storages, a private file physically
cannot be written to the public bucket — the separation stops depending on
application logic being correct.

Both tables carry `exif_stripped`. Field officers photograph workshops on
phones; phone photos carry GPS coordinates in EXIF. Section 10 commits to
minimal collection, and an un-stripped photo can expose a workshop owner's home
address. Strip on upload with Pillow, record that you did.

### 4. `ListingConfirmation` — new table

Section 09 defines the freshness cycle: prompt every 90 days, mark unconfirmed
after 30 days without a reply, show the date last checked. That needs a log of
prompts sent and confirmations received, not just a timestamp — otherwise you
cannot tell "confirmed last week" from "never prompted".

### 5. `Suspension` — new table

Section 09: "Listing can be suspended immediately by staff, with the reason
logged." There is nowhere to log the reason. Given that suspension follows a
complaint about a real business, this is the record you will want to produce if
the decision is ever challenged.

### 6. `Trade.synonyms` — new field

Section 05 chooses Postgres full-text search, which is right. But FTS will not
match *welder* to *welding*, *sewing* to *tailoring*, or *fitter* to *auto
mechanic* — and those are how people actually search. A synonyms array on Trade,
combined with the `pg_trgm` extension in `core/migrations/0001_extensions.py`,
covers it. Cheap now; a search rewrite later.

---

## The sixteen tables

| # | Table | Status | Holds |
|---|-------|--------|-------|
| 1 | `Region` | **new** | Ghana's 16 regions. Slug, name. Seeded once |
| 2 | `Area` | **new** | Town or district within a region. Slug, name, FK Region, centroid point |
| 3 | `Trade` | changed | Fixed list, staff-extended, never free text. **+ `synonyms`**, `slug`, `display_order` |
| 4 | `Provider` | changed | Workshop or training centre. **+ FK Area**, location point, status, `last_confirmed_at` |
| 5a | `ProviderPhoto` | **new** | A public workshop photograph. FK Provider, image, caption, `display_order`, `exif_stripped`. Public bucket |
| 5b | `ProviderEvidence` | **new** | Verification evidence or owner ID. FK Provider, optional FK Verification, `kind`, `exif_stripped`. Private bucket, signed URLs only |
| 6 | `Programme` | as written | A course. Fee, instalments, duration, weekly schedule, capacity. FK Provider, FK Trade |
| 7 | `Intake` | as written | A dated start. Start date, places offered, places remaining. Drives the Starts filter |
| 8 | `Verification` | as written | One completed Fliiptech check. Date, officer, what was checked, evidence, outcome, expiry |
| 9 | `GovernmentStatus` | as written | CTVET registration as documented. Separate table by design, allowed to be empty |
| 10 | `ListingConfirmation` | **new** | One prompt/response in the 90-day cycle. FK Provider, sent, responded, channel, confirmed_by |
| 11 | `Enquiry` | as written | A trainee contacting a provider. Phone, programme, intake, message, state, reference code |
| 12 | `EnquiryOutcome` | **reduced** | Replied, visited, enrolled. **Completion and attestation moved to `Enrolment`** |
| 13 | `Enrolment` | **new** | A person who started a programme. FK Provider/Programme/Intake, **nullable FK Enquiry**, phone, `completed_on`, `provider_attestation`, `attested_on` |
| 14 | `Subscription` | as written | Tier, price, period, state. Deliberately simple until pricing is tested |
| 15 | `Suspension` | **new** | FK Provider, reason, evidence, raised_by, started, lifted |

Staff accounts use Django's built-in `User` with groups for *field officer* and
*operations lead* — Section 09's two-person approval step is a permission, not a
table.

---

## Relationships

```
Region 1 ──< Area 1 ──< Provider
Trade  1 ──< Programme

Provider 1 ──< Programme 1 ──< Intake
Provider 1 ──< ProviderPhoto           (public bucket)
Provider 1 ──< ProviderEvidence        (private bucket) ?──1 Verification
Provider 1 ──< Verification            (history retained, never overwritten)
Provider 1 ──? GovernmentStatus        (optional, may be absent)
Provider 1 ──< ListingConfirmation
Provider 1 ──< Suspension
Provider 1 ──< Subscription
Provider 1 ──< Enquiry 1 ──? EnquiryOutcome

Enrolment ?──1 Enquiry                 (nullable: most enrolments have no enquiry)
Enrolment  >──1 Provider, Programme, Intake
```

---

## The structural rules, restated

The PDF's three rules hold, with one addition.

1. **Verification and government status are never joined into one displayed
   field.** A provider can be visited by Fliiptech with no CTVET record, or hold
   a CTVET registration and never have been visited. Both states must be
   expressible and both must render honestly. Collapsing them into a single
   trusted flag is the change most likely to create a legal problem later.

2. **Every change to a provider or a verification carries a timestamp and an
   author.** This is what `django-simple-history` is in the dependency list for.
   Register it on `Provider`, `Verification`, `GovernmentStatus` and
   `Programme` — the four a trainee could dispute.

3. **Completion and attestation are captured from version 1**, even though
   nothing in version 1 reads them. They cannot be recovered retrospectively.
   They now live on `Enrolment`, so they cover every trainee at a listed
   workshop rather than only the attributed ones.

4. **Added: public and private media never share a bucket.** `ProviderPhoto`
   binds to the public storage and `ProviderEvidence` to the private one, so
   the separation is structural rather than a flag that application code has to
   respect. Verification evidence and owner identification are served only
   through signed URLs with a short expiry, and never appear in a public API
   response.

---

## Two more things worth deciding at model time

**Provider authentication.** Section 02 says owners will not maintain their own
profiles, Section 03 says being asked to log in is what makes them give up — and
then Screen 5 is a dashboard they log into and Section 09 has them recording
outcomes there. No auth mechanism is specified anywhere. The only approach
consistent with the rest of the document is a tokenised magic link delivered over
WhatsApp: no password, no username, no account creation. That needs a
`LoginToken` model or a signed URL scheme, and it should be decided before the
Provider model is written.

**Response rate.** Screen 5 leads with four numbers, one of which is response
rate. The conversation moves to WhatsApp by design, so the platform cannot
observe whether a provider replied — the same measurement problem the document
honestly admits for enrolments, but does not admit here. Either define it as
something observable ("acknowledged in the dashboard within N hours") and store
that, or cut it from the screen. It cannot stay as written.


---

## Addendum, September 2026: trainee accounts

Four tables in a new `trainees` app, and one nullable link on two existing ones.

| Table | Holds |
|---|---|
| `TraineeAccount` | Verified phone (unique), optional name, preferred channel (WhatsApp or Telegram), active flag, last seen. Sits on a dedicated Django user with no password, no staff flag and no permissions. Change history kept |
| `SavedProvider` | Trainee and provider, unique together |
| `SupportSession` | Staff user, trainee (kept as null if the account is erased), reason, edit flag, start, expiry, end and why it ended |
| `SupportSessionEvent` | One request or change made during a support session |

`Enquiry.trainee` and `Enrolment.trainee` are nullable foreign keys to
`TraineeAccount`. They are filled by phone number match, so the rule that most
enrolments have no enquiry behind them is unchanged: an enrolment can belong to
a trainee account whether or not it came through the platform.

`PhoneVerification.purpose` gains `trainee_access`. A trainee sign-in counts as
verification for the enquiry flow; a trainer sign-in does not.
