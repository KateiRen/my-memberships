# My Memberships

A lightweight wallet for membership cards and their barcodes. The goal is a website you can also install as a Progressive Web App (PWA), with your cards available offline after the first visit.

**Mobile first:** optimize for using a phone at the store, in both the mobile browser and installed PWA. All feature specifications, interaction design, performance decisions, and acceptance checks must prioritize the mobile experience. Desktop use remains supported and accessible, but is secondary and must not drive compromises to the phone experience.

**Status:** Initial MVP implemented. Local automated checks cover the wallet and offline browser flows; real-device release checks and the first production deployment are still required.

**Hosting:** this repository's GitHub Pages site at https://kateiren.github.io/my-memberships/. The [deployment workflow](.github/workflows/pages.yml) builds, tests, and deploys pushes to `main`. Enable **Settings → Pages → Build and deployment → Source: GitHub Actions** before the first deployment. Other branches and pull requests do not publish to production.

## Run locally

Use Node.js 22.12 or newer and npm.

```sh
npm ci
npm run dev
```

Open the printed URL at `/my-memberships/`. Development mode does not install a service worker. For the production PWA and offline behavior:

```sh
npm run build
npm run preview
```

### Checks

```sh
npm run check
npm test
npx playwright install chromium webkit
npm run build
npm run test:e2e
```

Browser tests run against the production build in Android/Chromium and iPhone/WebKit emulation, covering card editing, search, backup/restore, language selection, narrow screens, offline reloads, and conflicting edits across tabs. They do not replace testing installation, file handling, and barcode scanning on physical phones.

The asset script generates optimized artwork and PWA icons from the original branding images before development and production builds. Generated assets are not committed.

## First release

The MVP includes manual card creation, editing and deletion, name search, alphabetical ordering, barcode display, offline use, and JSON backup/restore. The interface supports English and German from the start. Categories are optional user-entered values with suggestions from existing categories. Saved locations can be entered as coordinates with an optional label; map and address search come later.

Camera scanning, other-wallet imports, nearby-business lookup, and cloud sync are outside the MVP.

## Nearby cards

Tap **Enable nearby cards** in the wallet or settings to allow location access. Once browser permission is granted, opening or returning to the app checks your position without delaying card access. All cards with a saved location within **200 metres** appear first, with alphabetical ordering within the nearby and remaining groups. Search still works as usual.

When viewing a card, a small location-pin button lets you **save the current location** if that card has no saved location within 200 metres. It disappears after saving or when an existing saved location covers the area. The button requires a recent position accurate to 200 metres or better; it is not shown when location is denied, unavailable, or the card already has 50 locations. Saved points can be edited or removed in the card editor and are included in backups.

Restoring a backup containing locations asks whether to enable nearby suggestions if no decision has been recorded. Accepting requests browser permission; declining is remembered without requesting it. Your choice is saved on this device independently of wallet backups. Settings show whether location is enabled, disabled in the app, not yet enabled, or blocked by the browser. You can turn it off or **Ask for location access again** after a refusal. A browser-level block may need to be removed in the browser's site settings before another request can succeed. Turning the feature off prevents automatic location checks even if browser permission remains granted. Browsers without geolocation-permission queries require manual activation for each visit.

Matching runs on your device without external store searches, background tracking, or a position history. Denied, unavailable, timed-out, or imprecise positioning leaves normal alphabetical ordering available. Physical-phone location and permission checks remain required.

## Branding

- **Future app icon:** [Wallet with cards inside](assets/branding/Elegantes%20Lederkartenetui%20mit%20bunten%20Karten.png).
- **Website and in-app artwork:** [Cards fanned out of the wallet](assets/branding/F%C3%A4cher%20aus%20bunten%20Einkaufskarten.png).

Keep these original images as branding sources; generate app-icon sizes from the wallet image when implementing the PWA.

## Planned card details

Each membership card stores:

- Its name and membership number (preserving leading zeros).
- A description and category.
- The date it was added.
- Two brand colors.
- Multiple saved locations, for bringing the card to the top when nearby suggestions are enabled.

Cards will also support barcode display.

## Later features

- Import cards by scanning with the camera, reading a Stocard backup, or reading supported exports from other wallets. Supported backup formats will need to be verified during implementation.
- Look up nearby stores or businesses associated with cards already in the wallet. Matching against explicitly saved locations is already supported; external business discovery remains deferred.

## Where your cards will live

The app will keep cards in your browser on each device, with no My Memberships account or hosted wallet database. Browser storage can be cleared, so the first version will include backup and restore using a file you control. You can save that file in Google Drive, OneDrive, or iCloud Drive and import it on another device. Saving a file there is a backup, not automatic wallet sync.

Direct Google Drive and OneDrive sync are possible later, with optional sign-in to the provider you choose. iCloud Drive is planned as a manual file option.

See [Architecture.md](Architecture.md) for the design and development milestones. This project is licensed under the [MIT License](LICENSE).
