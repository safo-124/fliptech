# Interface text and translations

Every word the site shows lives here. `en.json` is the English, and the source
of truth: code refers to messages by key (`EnquiryForm.phoneLabel`) and the
compiler rejects a key that is not in it.

`tw.json` (Twi) and `gaa.json` (Ga) are the translations. They may be
unfinished: anything they leave out is shown in English, so a language can be
switched on as it grows rather than after its last string.

## Translating, without editing JSON

From `frontend/`:

```bash
pnpm messages:export tw > twi.csv
```

Open `twi.csv` in Google Sheets (or Excel, saving as "CSV UTF-8"). Each row is
a key, the English, and a column for Twi. Fill in the third column, download
it as CSV and bring it back:

```bash
pnpm messages:import tw twi.csv
pnpm messages:status
```

The import refuses rows that would break a page, and says which:

- **Keep anything in braces exactly as it is.** `{name}`, `{count}` and the
  like are filled in by the site: "Back to {name}" becomes "Back to Accra
  Welding Works". In `{count, plural, one {# course} other {# courses}}` the
  words inside may change, and other languages can use other plural forms,
  but `{count, plural,` stays.
- **Keep tags like `<strong>…</strong>`** around the same words.
- An empty cell stays English. That is fine.

Export again at any time to pick up new English text: rows already translated
come back filled in.

## Seeing it on the site

A language appears in the footer once it is switched on:

- `NEXT_PUBLIC_LOCALES=en,tw` in `frontend/.env.local` (development) or
  `frontend/.env.production` (the server, then redeploy, since it is fixed at
  build time);
- `INTERFACE_LANGUAGES=tw` in `backend/.env`, so the API's error messages
  follow. Those are translated separately: see `backend/locale/README.md`.

Switch it on in development or staging first, so translators can read their
work in place before anyone else sees it.

`pnpm test` checks every translation: no stale keys, and every `{argument}` and
tag the English uses.
