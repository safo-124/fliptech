# Fliiptech mobile app

The Android and iPhone app, one codebase, built with Expo and React Native.
It talks to the same Django API as the website, in `../backend`. What is
different on an iPhone, and how to build and release it, is under
[The iPhone app](#the-iphone-app).

## What is here

- **Five tabs** in a floating bar: Home, Explore (training near you), Learn
  (online courses), Shop (the marketplace) and Me. The active tab sits in a
  purple bubble; the bar slides away while scrolling down and comes back on
  the way up. See `src/components/FloatingTabBar.tsx`.
- **Real data** from the API on every tab, cached for a minute so moving
  between tabs on a slow connection shows what was loaded.
- **The website's brand:** colours converted from `frontend/src/app/globals.css`
  into `src/theme/tokens.ts`, the Inter font, and app icons drawn from the
  same mark as the site's (`frontend/src/lib/brand-mark.ts`).
- **The training map**, from the round button in the top-right corner of
  Explore and of the Home card: every workshop as a pin in its trade's
  colour, grouped into a numbered bubble where they crowd, a filter by
  trade, "near me", "search this area" after moving the map, and a card
  with directions and the workshop's page. MapLibre (open source, no
  Google) with OpenStreetMap tiles, like the website. See `src/app/map.tsx`.
  **For now**, where MapLibre is not in the app (Expo Go), the same map is
  drawn with Google Maps (`react-native-maps`, built into Expo Go), so it
  shows something; `src/components/map/WorkshopMap.tsx` picks. A store build
  that uses Google Maps needs a Maps API key in `app.json`
  (`android.config.googleMaps.apiKey`).
- **Sign in with a phone number** and a texted code (`src/app/sign-in.tsx`),
  the same login as the website. The app keeps a token in the phone's secure
  storage and sends it as `Authorization: Bearer flt_…`; the backend
  (`backend/accounts/app_auth.py`) turns it into the signed-in user, so every
  API endpoint works for the app unchanged. Staff can sign a phone out from
  Django admin (App tokens).
- **Native screens:** a workshop (photos, courses, fees, intakes, directions)
  and its Enquire form; a course player (HLS streaming, your place kept,
  lessons saved to the phone for no-data days, buying with Paystack,
  certificate); a product, the bag (one checkout per seller) and checkout;
  My courses and My orders.
- **Paying:** Paystack opens in a browser sheet over the app. When paid,
  Paystack returns to the website's `/app-return`, which opens
  `fliiptech://paid` and closes the sheet; the app then asks the API whether
  the money arrived. The website must be deployed with `/app-return` for this.
- **Teaching videos** for trainers (Me, "My workshop: videos",
  `src/app/trainer/videos.tsx`): the website's Videos tab, with its limits
  and words, and a tick that the video follows the guidelines. The video
  comes from the gallery (expo-image-picker, which copies it into the
  app's cache first; the app deletes that copy once the upload is finished,
  cancelled or removed) or from the phone's files (expo-file-system's
  picker, no copy). It is sent 2 MB at a time with an `Upload-Offset`, as
  the website does (`src/lib/video-upload.ts`). The app remembers which
  file each unfinished upload came from, so one stopped by the app closing
  carries on with a tap, and one stopped by the network carries on by
  itself when the connection is back. The screen stays on while it sends;
  leaving the screen pauses it. The trainer endpoints take the app's token
  as they are (see `backend/accounts/app_auth.py`).
- **Password** (Me, signed in; `src/app/change-password.tsx`): set one
  (an account made with a phone code has none) or change it with the
  current one, as on the website's account page. The server signs out the
  person's other phones and browsers; this phone stays signed in.
- **Reporting a lesson:** "Report this video" under the course player,
  for anyone signed in (`src/components/ReportVideoSheet.tsx`). Trainers'
  videos can go live before staff have watched them; this is how staff
  hear about a bad one.
- A few account rows (saved things, selling, joining as a trainer) still
  open the website's page **inside the app** (`src/lib/open.ts`).

```
src/
  app/                 screens (Expo Router: every file is a route)
    _layout.tsx        fonts, splash screen, data cache
    (tabs)/            the five tabs and their layout
  components/          the tab bar, cards, sections, states
  lib/                 API client, config, formatting
  theme/tokens.ts      colours, type, spacing, shadows
test/                  Jest stand-ins
```

## Running it on an Android phone

The map uses MapLibre, which Expo Go does not include, so the app runs in
its own **development build**: an APK of this app with the developer tools
in it. Build it once (and again only when a native library is added):

```bash
cd mobile
npm install
npx eas-cli@latest build --platform android --profile development
```

Install the APK it links to on the phone. Then, day to day:

1. Start the backend (see `../SETUP.md`) so it listens on your network:
   `python manage.py runserver 0.0.0.0:8000`, with your computer's address
   in `DJANGO_ALLOWED_HOSTS`. Or use the staging server.
2. Set the API address:
   ```bash
   cp .env.example .env   # then put your computer's address in it
   ```
3. Start the app and open it in the development build (scan the QR code,
   on the same Wi-Fi):
   ```bash
   npx expo start
   ```

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run export:android   # bundles for Android, as a build would
npx expo export --platform ios   # the same for iPhone (works on Windows)
```

## Building an installable app

With an Expo account (free) and the EAS CLI:

```bash
npx eas-cli@latest build --platform android --profile development  # for developing (see above)
npx eas-cli@latest build --platform android --profile preview      # an APK to share for testing
npx eas-cli@latest build --platform android --profile production   # an AAB for the Play Store
```

The profiles are in `eas.json`; `preview` and `production` point at the
live site, https://fliiptech.com.

## The iPhone app

The same screens as Android, from the same code. What is different:

- **Courses are not sold on an iPhone.** Apple's rule (App Store Review
  Guideline 3.1.1) is that an iPhone app selling digital content, an online
  course included, must use Apple's in-app purchase. So on an iPhone a paid
  course shows no price and no buy button, learn-and-buy bundles that open
  a course are left out, and nothing points to buying elsewhere (the same
  rule forbids that). Free lessons play, and a course the person owns opens
  in full once they sign in. Workshop training, the shop and its checkout
  are paid with Paystack as on Android: Apple allows any payment for things
  used outside the app. All of it is in `src/lib/store-rules.ts`.
- **Directions** open Apple Maps (`src/lib/directions.ts`); Android uses
  `geo:`, which an iPhone does not have.
- **The gallery** is Apple's own picker, so the app asks for no access to
  the photo library. Videos arrive as filmed, often `.MOV`, which the
  server takes.
- **Saved lessons** go in the app's Caches folder, not Documents (Apple
  rejects apps that back videos up to iCloud). An iPhone very short of
  space may clear them; they then show as not saved.
- **Notices** arrive less promptly: iOS runs the background check when it
  chooses, often only a few times a day, where Android runs it as often as
  every 15 minutes (`src/lib/notices.ts`). They are always there when the
  app opens.
- **Links to the site** open the app once the website serves
  `/.well-known/apple-app-site-association` with the team ID (see
  `../DEPLOY.md`, "Links open the app").

### Building and releasing

You need the Apple Developer Program (US$99 a year, developer.apple.com),
signed up with the Apple ID you will use below. No Mac is needed: EAS builds
in the cloud, and asks for that Apple ID the first time, to make the
certificates and profiles itself.

```bash
cd mobile
npx eas-cli@latest build --platform ios --profile production   # for TestFlight and the App Store
npx eas-cli@latest submit --platform ios --latest              # sends it to App Store Connect
```

The first submit creates the app in App Store Connect. The build appears in
TestFlight about 15 minutes later: add yourself and your testers there, and
install it with the TestFlight app. When it is ready for everyone, fill in
the store listing (screenshots from a 6.9-inch iPhone, a privacy policy
address, the privacy answers) and send it for review.

For the review, give Apple a demo account that signs in with a phone number
and a **password** (Apple's reviewers cannot receive a Ghanaian text). A
trainer account too, if you want them to see the trainer screens.

To put a build on particular iPhones without TestFlight, register each one
(`npx eas-cli@latest device:create`, which gives a link to open on the
phone), then build the `preview` profile.

## Notes

- Add native libraries with `npx expo install <name>`, which picks versions
  that match this Expo SDK. Third-party JavaScript libraries are pinned
  exactly, like the rest of the repository.
- `android/` and `ios/` are generated by Expo when building; never edit or
  commit them. Native settings belong in `app.json`.
