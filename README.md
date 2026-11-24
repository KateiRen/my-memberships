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

Camera scanning, other-wallet imports, nearby-card ordering, and cloud sync are outside the MVP.

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
- Multiple saved locations, for automatically bringing the card to the top when nearby once location-based sorting is available.

Cards will also support barcode display.

## Later features

- Import cards by scanning with the camera, reading a Stocard backup, or reading supported exports from other wallets. Supported backup formats will need to be verified during implementation.
- With the user's permission, check their position when opening the app and look up nearby stores or businesses associated with cards already in their wallet. Matching cards will appear at the very top. Saved card locations will also support nearby matching; location access will remain optional.

## Where your cards will live

The app will keep cards in your browser on each device, with no My Memberships account or hosted wallet database. Browser storage can be cleared, so the first version will include backup and restore using a file you control. You can save that file in Google Drive, OneDrive, or iCloud Drive and import it on another device. Saving a file there is a backup, not automatic wallet sync.

Direct Google Drive and OneDrive sync are possible later, with optional sign-in to the provider you choose. iCloud Drive is planned as a manual file option.

See [Architecture.md](Architecture.md) for the design and development milestones. This project is licensed under the [MIT License](LICENSE).
