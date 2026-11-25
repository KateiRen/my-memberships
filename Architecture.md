# Architecture

## Product priority: mobile first

The primary experience is using a phone at the store, either in a mobile browser or as an installed PWA. Every feature specification and implementation milestone must define and validate its mobile flow first. Desktop remains usable and accessible, but is a secondary experience, not the optimization target.

- Design narrow-screen, touch-first layouts with primary actions reachable one-handed, touch targets at least 44 by 44 CSS pixels, and no hover-only interactions. Preserve keyboard and screen-reader access.
- Prioritize opening the wallet, finding a card, and displaying a large, unobstructed, scannable barcode with minimal interaction. Do not make card access wait for location lookup, cloud sync, or decorative artwork.
- Account for phone safe areas, browser chrome, the on-screen keyboard, text enlargement, and orientation changes. Core flows must not require horizontal page scrolling.
- Keep startup and interactions responsive on mid-range phones and constrained networks. After the first successful load, the core wallet must remain usable offline.
- Validate on representative iOS Safari and Android Chrome devices, in browser and installed modes where supported. Test mobile file pickers and share sheets, permission prompts, and camera flows on devices rather than relying solely on desktop viewport emulation.
- Provide responsive desktop layouts and keyboard operation without introducing desktop-only dependencies into core flows. Apply these priorities to future import, nearby-card, and sync specifications as well.

## Agreed MVP scope

- Manual card creation, editing, and deletion; a card list with name search and alphabetical ordering; and a card detail view with barcode display.
- IndexedDB persistence, an offline app shell, PWA installation where supported, and the app's own JSON backup/restore. Opt-in nearby ordering using saved locations is an implemented enhancement. Camera scanning, other-wallet imports, nearby-business discovery, and cloud sync remain later features.
- English and German interfaces from the first release. Keep UI strings translatable and use locale-aware sorting and date display; do not translate user-entered card data.
- An optional user-entered category with suggestions from categories already in the wallet. Dedicated category management, favorites, and custom ordering are deferred.
- Optional saved locations entered manually as coordinates with an optional label. Map selection and address search are deferred; creating a card must not require a location or location permission.
- Manual barcode entry with an explicit format selector. Initially support Code 128, EAN-13, EAN-8, and QR. Default the barcode value to the membership number while allowing a separate value. Validate the selected format rather than guessing it or silently substituting another format. Cards without a barcode remain valid.

## Decision: local-first PWA

Serve a static web app over HTTPS on a stable origin. No app server, wallet database, or My Memberships login is required. The host serves the app assets; reading, editing, and displaying cards happen on the device. A web app manifest and icons support installation where the browser offers it. A service worker caches the app shell for offline use after the first successful load; it does not cache wallet data, cloud API responses, or tokens.

## Decision: GitHub Pages and automated deployment

Host production on this repository's GitHub Pages site at `https://kateiren.github.io/my-memberships/`. Use GitHub Actions runners for build and deployment automation; they are not an application backend.

- Automatically build, run required checks, and deploy on every push to `main`, without path filters that skip commits. Only publish a successfully validated build; failed checks must leave the existing deployment intact.
- Pull requests and other branches must not deploy to production.
- Configure Pages to deploy through GitHub Actions, using a Pages artifact and the official Pages deployment actions. Restrict deployment permissions to the deployment job and use the `github-pages` environment.
- Serialize production deployments so an older build cannot replace a newer deployed commit.
- Configure asset URLs, navigation, manifest start URL and scope, and service-worker registration and scope for the `/my-memberships/` base path, not the domain root. Use navigation compatible with static Pages hosting; do not assume server-side SPA rewrites.
- Verify the deployed site, installation, and offline behavior at the actual Pages URL. Publishing a new version must not clear the local wallet; already-installed clients follow the service-worker update flow rather than receiving an immediate forced reload.

The workflow is implemented in [pages.yml](.github/workflows/pages.yml). It runs unit and production-browser tests before uploading an artifact, and skips publishing a commit superseded on `main`. Repository Pages settings must use GitHub Actions before the first deployment. A successful local build does not verify a production deployment.

## Wallet storage

- Use **IndexedDB** for structured, transactional storage. Cookies are small and sent with requests; `localStorage` is synchronous and not a good fit for a wallet. A browser file picker requires user interaction and is useful for backup, not as the primary store.
- Each card stores a stable ID and the following details:
  - Issuer or display name.
  - Membership number as a string, preserving leading zeros.
  - Description and category.
  - Date added, recorded at creation and preserved through edits, backup, and restore.
  - Two brand colors.
  - A list of saved locations, each with coordinates and an optional label or address. Allow multiple locations per card; these are inputs to opt-in nearby-card suggestions.
  - Optional barcode format and value.
- Render supported barcodes locally. Use a versioned database schema with migrations and keep storage logic separate from the UI. Include all card details and saved locations in the versioned backup format.
- Storage belongs to the browser profile and origin. Different devices, browsers, or origins do not automatically share a wallet. Request persistent storage when supported, but explain that clearing site data, browser eviction, or losing a device can still erase cards. Installing the PWA is not a backup.

## MVP: file backup and restore

Export a JSON snapshot with a format version and a cards array (suggested filename: `wallet.memberships.json`). Download it or use the system share/save UI when available. Users can move the file to Google Drive, OneDrive, or iCloud Drive using their device's files app or the provider's website, then select it with the app's standard file picker to restore it. No provider SDK, credentials, or account setup is required by the app. A cloud folder can sync the backup **file**, not the browser's live wallet.

On restore, validate the version, size, and card fields before writing anything. Show a preview and ask before replacing an existing wallet; apply the replacement atomically so a failed import leaves the existing wallet intact. Treat imported values as data, not HTML. Tell users that exports are readable JSON containing their membership numbers and barcodes; do not log or send those values to analytics. Keep third-party scripts out of the core app and use a restrictive Content Security Policy.

## Later: camera and other-wallet imports

Support adding cards by scanning a barcode with the camera, importing a Stocard backup, and importing supported exports from other wallets. These are separate from restoring the app's own JSON backup. Verify available export formats and compatibility before claiming support; do not assume every wallet exposes an importable backup.

Request camera access only when scanning and retain manual entry if permission is denied or scanning is unsupported. Decode supported barcodes on the device and let the user review or complete card details before saving. For file imports, map available source fields into the card model, preserve the original date added when provided, and record the import date otherwise. Preview imported cards and resolve duplicates with the user rather than silently replacing existing cards. Apply the same input validation and data-handling protections as backup restore.

## Saved-location suggestions

Nearby suggestions are opt-in through an **Enable nearby cards** action in the wallet and settings. There is no automatic browser permission prompt at startup. When the browser reports existing geolocation permission as granted and the feature is not explicitly disabled, request a foreground position when opening or returning to the app, or opening a card with an expired fix. Location reads must not block opening cards or editing. If permission queries are unavailable or fail, explain that manual activation is required for that visit rather than triggering an unexpected prompt.

Use the same **200-metre inclusive great-circle-distance threshold** for matching saved locations and detecting an already-saved area. A fix is usable only when its accuracy is at most 200 metres and it is no more than 60 seconds old. Use a temporary high-accuracy geolocation watch with no cached positions and a 15-second overall deadline. Keep waiting through approximate initial readings and transient unavailable/timeout callbacks, allowing the phone's location to improve. Stop the watch and deadline timer immediately on an acceptable fix, permission denial, app hiding, or deadline expiry. If no acceptable fix arrives, report imprecision, unavailability, or timeout as appropriate. Denied, unavailable, imprecise, and timed-out positioning are explained, clear suggestions, and retain alphabetical ordering. Discard the in-memory position when hidden, expired, disabled, or permission is revoked; ignore late callbacks after revocation or hiding. Do not retain position history or continuously watch location.

All matching cards precede non-matching cards, with existing locale-aware alphabetical ordering within each group. Preserve name filtering, and never write the temporary ordering into the wallet. Multiple saved locations and multiple matching cards are supported, including offline use when the device can supply a position. No place-data service or network business lookup is used.

On the card detail screen, show a small location-pin action with an accessible label and a minimum 44-by-44-pixel touch target only when a usable fix is available, no saved location on that card is within 200 metres, and the card has fewer than 50 locations. On activation, refresh the fix and recheck duplicates and limits before saving an unlabeled coordinate pair through the normal revision-checked wallet transaction. Report success only after persistence. Card details, barcode data, and date added stay unchanged. Saved coordinates remain editable and are included in the existing backup format.

Store explicit nearby opt-in or refusal as a boolean under `nearby-enabled` in the existing IndexedDB preferences store, separately from language and wallet snapshots; no database or backup schema version change is needed. A successful restore containing saved locations offers nearby suggestions if the user has not made a decision and browser permission is not already granted or denied. Accepting saves opt-in and requests browser permission; refusal is persisted without requesting browser location. Native permission denial also disables nearby suggestions. Repeated restores must not repeat a declined prompt, and restoring a backup must not overwrite this device's preference. Settings allow re-enabling or disabling the feature; disabled means no automatic reads even with browser permission still granted.

Physical Android and iOS checks remain necessary for GPS accuracy, permission prompts and revocation, app resume, narrow-screen touch targets, and installed-PWA behavior.

Settings display an explicit enabled, app-disabled, not-yet-enabled, or browser-blocked location indicator. Allow disabling active suggestions and requesting permission again after refusal. Browsers cannot be forced to repeat a blocked native prompt; explain how to allow location through browser site settings before retrying.

## Later: nearby-business discovery

Optionally extend saved-location matching with a lookup of nearby stores or businesses associated with cards already in the wallet. Bring matching cards to the very top without adding unrelated cards or permanently changing the user's normal ordering.

Use the browser's foreground geolocation API; do not require background tracking or retain a position history. If permission is denied, location is unavailable, or a nearby-place lookup fails, explain the issue and keep the normal wallet ordering usable. Saved-location matching can work without a place-service request when a position is available; discovering nearby businesses may require network access.

Before implementation, select a place-data source compatible with the static-app architecture, verify browser access and credential requirements, and disclose any position data sent to that service. Define and test proximity thresholds, business-to-card matching, and ordering when multiple cards match before rollout.

## Later: opt-in cloud sync

Keep IndexedDB as the working copy. If a user connects a provider, a separate adapter transfers a versioned wallet snapshot directly between the browser and that provider. The provider account is only for sync; local editing and manual backup work without it.

| Provider | Proposed integration |
| --- | --- |
| Google Drive | Use [Google Identity Services' browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) and the [Drive API application data folder](https://developers.google.com/workspace/drive/api/guides/appdata) (`appDataFolder`, `drive.appdata` scope). The folder is hidden from the Drive UI, so retain manual export as a separate feature. |
| OneDrive | Register a single-page app and use [authorization code with PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) and the [Microsoft Graph app folder](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder) with delegated `Files.ReadWrite.AppFolder`. Verify permission and account-type support before rollout. |
| iCloud Drive | Keep manual import/export. CloudKit is app-scoped storage, not a web API for reading and writing a user's general iCloud Drive files. |

Register each provider integration with production and development origins or redirect URIs as required. Public client IDs may ship in the browser; client secrets must not. Use supported provider libraries, request only app-folder permissions, and do not store tokens in the wallet database, backups, or service worker cache. Start with foreground sync and prompt for reauthorization when needed rather than promising unattended background sync.

Track the last successfully synced snapshot and remote revision per connected account. On initial connection, ask which wallet to keep if both have data. After that, upload local-only changes and apply remote-only changes. If both changed, preserve both versions and ask the user which to keep; do not silently overwrite or resurrect deleted cards by merging arrays. Use conditional writes against the remote revision where supported. Validate safe concurrency handling before enabling automatic writes for a provider; otherwise keep it a manual backup option. Offline edits stay local and pending until sync succeeds. Disconnecting stops sync without deleting the local wallet or provider backup.

## Implementation milestones

1. **Wallet:** build the mobile-first web UI, IndexedDB storage for all planned card details (including two brand colors and multiple locations), and barcode display. Verify that card creation, editing, and deletion survive reloads without an account or network requests for card data. Validate touch operation, narrow-screen layouts, accessibility, and barcode scanning from a phone display; also check desktop usability.
2. **PWA and backup:** add installation, offline app shell, and export/restore. Test a first online load followed by offline use, a restore in a clean browser profile, and invalid imports leaving the existing wallet untouched. Prioritize installation, file selection, and export/share flows on Android and iOS devices, with secondary desktop compatibility checks.
3. **Cloud sync:** prototype one provider at a time. Verify account consent, token expiry, offline edits, conflicts between two devices, and disconnect/reconnect before rollout. Review whether users should be able to encrypt cloud snapshots before enabling sync.

Additional later milestones:

- **Card imports:** implement camera scanning, Stocard backup import, and other-wallet adapters as supported formats are verified. Test camera denial, unsupported barcodes and formats, field mapping, duplicate handling, and malformed files without changing existing cards.
- **Nearby businesses:** extend implemented saved-location matching with a separately approved nearby-business lookup. Test lookup failures, false business matches, and ordering when local and external suggestions overlap.

## MVP implementation choices

- **Toolchain:** TypeScript with strict checking and Vite, without a UI framework. `idb` provides transactional IndexedDB access; named `bwip-js` renderers generate only the four supported barcode formats as SVG, without network requests. Vitest and fake IndexedDB cover the data layer; Playwright covers production browser flows. Vite PWA/Workbox generates the offline app shell. Sharp derives icons and optimized artwork from the original branding images. The Workbox build dependency's `glob` is overridden to a patched release; production generation and offline tests exercise that integration.
- **Data contract:** database schema version 1 and backup format `{ "format": "my-memberships", "version": 1, "cards": [...] }`. Names (100 characters) and membership numbers (200) are required. Description (2,000) and category (60) default to empty strings. Colors default to `#c5ed76` and `#275c4b` and must be six-digit hex values. IDs are unique, URL-safe strings of up to 100 characters; newly created IDs are UUIDs. The creation timestamp is a canonical UTC ISO string and is immutable in the editor.
- **Limits:** at most 2,000 cards, 50 locations per card, and 5 MiB of UTF-8 JSON for either a wallet snapshot or an imported file. Enforce the snapshot limit on writes so every saved wallet remains exportable. Location labels are at most 150 characters; latitude and longitude must be finite numbers in `[-90, 90]` and `[-180, 180]`. Imports reject duplicate IDs, unsupported versions, malformed fields, and invalid barcodes before opening a write transaction.
- **Barcodes:** EAN values include their check digit and must pass checksum validation. Code 128 accepts up to 80 printable ASCII characters; QR accepts up to 1,024 UTF-8 bytes. A new card starts without a barcode. When enabling one, its value follows the membership number while the editor's checkbox is selected; deselect it to enter an independent value. When reopening the editor, equal values start linked, differing values start independent. No barcode format is inferred or silently changed.
- **Interaction:** empty and no-results states, category suggestions, explicit delete confirmation, and unsaved-edit warnings on in-app navigation and browser unload where supported. Browser unload prompts are not a guarantee on mobile; only a successful save persists edits. User-selected colors decorate the card; important text stays on a contrasting fixed background. English/German selection is persisted in IndexedDB, initially following the browser language with English fallback.
- **Concurrency and errors:** each whole-wallet write checks a revision within one read/write transaction. A stale tab cannot overwrite newer data, including during restore. Cross-tab notifications ask the user to reload; conflicting saves preserve the unsaved form. Storage and quota errors remain visible, and the UI reports success only after transaction completion. Database upgrade blocking/termination prompts recovery rather than silently switching to volatile storage. Future schema changes require migrations before raising the database version.
- **PWA updates:** precache only static app assets under `/my-memberships/`, with no runtime cloud caching. Offer an explicit update/reload action for a waiting worker; do not activate it automatically while editing. Warn about unsaved changes and other open tabs before applying an update. Hash-based navigation avoids a dependency on server-side rewrites.

## Remaining release validation

- Test current and previous major iOS Safari and Android Chrome releases on physical phones, including installed mode where offered. Desktop compatibility targets current Chrome, Firefox, Edge, and Safari. Automated Chromium/WebKit mobile emulation is not device or full-browser certification.
- Verify that store scanners can read each supported barcode format from real phone displays, and test installation, safe areas, keyboard interaction, screen-reader use, text enlargement, backup downloads/file selection, storage denial/quota errors, and an update with an unsaved form and another tab open.
- Initial asset budgets: combined JavaScript at most 100 KiB gzip, CSS at most 10 KiB gzip, and the static precache at most 1 MiB uncompressed. Measure cold wallet usability within 3 seconds on a representative mid-range phone over a constrained connection and saved-card opening within 200 ms; these device timing targets still need measurement.
- Enable Pages with GitHub Actions, publish the first validated commit, and verify installation, asset paths, updates, and offline reloads at the actual production URL. No production deployment has been verified yet.
