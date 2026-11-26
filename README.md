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

The MVP includes manual card creation, editing and deletion, name search, alphabetical ordering, barcode display, offline use, and JSON backup/restore. The interface supports English and German from the start. Categories are optional user-entered values with suggestions from existing categories. Locations are captured from the device when viewing a saved card, not entered manually; map and address search come later.

Other-wallet imports, nearby-business lookup, and cloud sync are outside the MVP.

Opening a card shows its name immediately followed by the barcode or QR code, without a category emblem or caption. The optional save-location action appears inside the scan panel directly below the code and its number, before the scan hint.

## Adding a card with the camera

Adding a new card opens the rear camera and looks for QR, Aztec, Code 128, Code 39, EAN-13, or EAN-8 codes. Camera access and decoding stay on the device; frames and decoded values are not uploaded. The local decoder also works offline after the app is ready for offline use. Camera-specific code and translations are loaded only for new-card scanning, not when opening the wallet or an existing card.

After detection, capture stops and the editor shows the exact decoded payload and detected format. Add the card name, review the fields, and save explicitly; scanning never saves a card by itself. Text up to 200 characters also fills the membership-number field. Longer QR text needs a separate membership number. The custom barcode field retains spaces, leading zeros, Unicode, and line breaks independently of the membership number. Saving, editing, backup, and restore preserve that payload. The regenerated code uses the detected symbology and content, not necessarily the original code's visual layout or error-correction settings. Existing format and size limits still apply; invalid values are rejected rather than converted to another format.

**Enter manually** stops capture, and **Scan with camera** allows another attempt. Editing any card field also stops scanning to avoid overwriting changes. Leaving the editor or hiding the app releases the camera, including a stream received after cancellation. Permission denial, missing cameras, and decoding/startup errors are explained while manual entry remains available. Physical Android and iPhone checks are still required for camera hardware, focus, permissions, and real-world scanning.

## Restoring a backup

When selecting a backup in settings, the app scrolls to the import preview and focuses **Replace wallet**, keeping the action above the bottom navigation. Review the preview before confirming; selecting a file alone does not replace your cards.

## Wallet display and filters

Settings place language selection above the location options. Enable **Use smaller card previews** there for compact cards: the entire card uses its first brand color and its name uses the second, with no separate caption or membership number underneath. The standard preview remains the default. This display preference is saved on the device, works offline, and is independent of wallet backups. Both the nearby and alphabetical sections use the selected preview style.

Category toggles below name search are drawn from all categories in the wallet, including **No category** when needed. Select multiple categories to show cards in any selected category; no selection shows all categories. Category filters and name search apply together to both card sections. **Clear filters** resets both. Filters stay active when opening and returning from a card, but reset on page reload.

## Nearby cards

In the wallet, a small location-pin button beside the location hint refreshes nearby suggestions. Turning nearby cards off remains available in settings.

Tap **Enable nearby cards** in the wallet or settings to allow location access. Once browser permission is granted, opening or returning to the app checks your position without delaying card access. When there are matches within **200 metres**, a separate **Nearby** section (German: **In der Nähe**) appears above **All cards**. Nearby matches are alphabetical; the complete alphabetical list below still includes those same cards. Search filters both sections. The extra section disappears when there are no matching search results nearby, location is disabled, or no usable position is available.

When viewing a card without any saved location and with location access enabled, a labeled location-pin button lets you **save the current location**. The button is visible even while the device is still locating you. Tapping it reads the device position, waits up to 15 seconds for sufficient accuracy, and saves only a recent fix accurate to 200 metres or better. If lookup fails, the app explains the problem and allows another attempt. The action disappears after saving; cards with existing locations do not show it, even when those locations are far away. Coordinates cannot be entered or changed manually. In the card editor you can rename or remove saved locations; imported locations remain intact and are included in backups.

Restoring a backup containing locations asks whether to enable nearby suggestions if no decision has been recorded. Accepting requests browser permission; declining is remembered without requesting it. Your choice is saved on this device independently of wallet backups. Settings show whether location is enabled, disabled in the app, not yet enabled, or blocked by the browser. You can turn it off or **Ask for location access again** after a refusal. A browser-level block may need to be removed in the browser's site settings before another request can succeed. Turning the feature off prevents automatic location checks even if browser permission remains granted. Browsers without geolocation-permission queries require manual activation for each visit.

Matching runs on your device without external store searches, background tracking, or a position history. The app waits up to 15 seconds for a high-accuracy reading, so an approximate initial phone position has time to improve. The temporary location watch stops as soon as accuracy reaches 200 metres or better, when the deadline expires, or when the app is hidden. Enable Precise Location for your browser in your phone settings if readings stay approximate; granting permission alone does not guarantee precise positioning. Denied, unavailable, timed-out, or imprecise positioning leaves normal alphabetical ordering available. Physical-phone location and permission checks remain required.

## Branding

- **Future app icon:** [Wallet with cards inside](assets/branding/Elegantes%20Lederkartenetui%20mit%20bunten%20Karten.png).
- **Website and in-app artwork:** [Cards fanned out of the wallet](assets/branding/F%C3%A4cher%20aus%20bunten%20Einkaufskarten.png).

Keep these original images as branding sources; generate app-icon sizes from the wallet image when implementing the PWA.

### Brand-color reference data

[src/data/brand-colors.json](src/data/brand-colors.json) contains 1,000 records converted from the user-provided `brand_colors_kundenkarten.csv`. Each record preserves the source name, category, website, ordered pair of six-digit hex colors, and logo URL:

```json
{
  "name": "H&M",
  "category": "Mode",
  "website": "https://www.hm.com",
  "colors": ["#CC1F25", "#CC1F25"],
  "logoUrl": "https://www.google.com/s2/favicons?sz=256&domain=hm.com"
}
```

All source color values are syntactically valid; their brand accuracy has not been independently verified. The dataset has 941 distinct names, with 39 names appearing more than once across different websites. Those records remain separate, including differing color pairs. Some names look domain-derived (such as `Www`) and some categories are broad or questionable; review these before adding name matching. No aliases or replacement colors were invented, and identical color pairs were preserved.

When creating a card, entering a matching brand name automatically fills both colors. Matching ignores case, punctuation, spaces, and accents; common membership suffixes such as "Rewards", "Card", or "Kundenkarte" are supported. Partial names and conflicting palettes are not guessed. For example, **Target** uses `#CC0000` and `#EB9D9D`. Changing to another matching name updates the colors; an unmatched name restores the default palette until you manually change a color. Changing either color stops automatic updates for that new card. Existing cards are never recolored when editing their names.

The asset step validates the reference data and generates a compact name-to-palette lookup, omitting metadata and marking conflicting palettes as ambiguous. This lookup is fetched locally and precached for offline use, keeping the complete reference file out of the JavaScript bundle. No website or logo URL is fetched. A loading failure is shown explicitly; manual colors remain available and entering the name again retries. The barcode library is bundled separately to stay within the unchanged mobile asset budgets.

## Planned card details

Each membership card stores:

- Its name and membership number (preserving leading zeros and spaces exactly as entered). Selecting **Use membership number as barcode value** omits whitespace from the encoded value, while the displayed number retains it. Scanned and custom code values are preserved exactly, even if they happen to equal the membership number.
- A description and category.
- The date it was added.
- Two brand colors.
- Multiple saved locations, for bringing the card to the top when nearby suggestions are enabled.

Cards will also support barcode display.

## Later features

- Import cards by reading a Stocard backup or supported exports from other wallets. Supported backup formats will need to be verified during implementation.
- Look up nearby stores or businesses associated with cards already in the wallet. Matching against explicitly saved locations is already supported; external business discovery remains deferred.

## Where your cards will live

The app will keep cards in your browser on each device, with no My Memberships account or hosted wallet database. Browser storage can be cleared, so the first version will include backup and restore using a file you control. Backups use human-readable JSON with two-space indentation; older compact backups can still be restored within the wallet size limit. You can save that file in Google Drive, OneDrive, or iCloud Drive and import it on another device. Saving a file there is a backup, not automatic wallet sync.

Direct Google Drive and OneDrive sync are possible later, with optional sign-in to the provider you choose. iCloud Drive is planned as a manual file option.

See [Architecture.md](Architecture.md) for the design and development milestones. This project is licensed under the [MIT License](LICENSE).
