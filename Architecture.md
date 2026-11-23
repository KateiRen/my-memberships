# Architecture

## Decision: local-first PWA

Serve a static web app over HTTPS on a stable origin. No app server, wallet database, or My Memberships login is required. The host serves the app assets; reading, editing, and displaying cards happen on the device. A web app manifest and icons support installation where the browser offers it. A service worker caches the app shell for offline use after the first successful load; it does not cache wallet data, cloud API responses, or tokens.

## Wallet storage

- Use **IndexedDB** for structured, transactional storage. Cookies are small and sent with requests; `localStorage` is synchronous and not a good fit for a wallet. A browser file picker requires user interaction and is useful for backup, not as the primary store.
- Start with cards containing a stable ID, issuer or display name, membership number (a string, preserving leading zeros), and optional barcode format and value. Render supported barcodes locally. Use a versioned database schema with migrations and keep storage logic separate from the UI.
- Storage belongs to the browser profile and origin. Different devices, browsers, or origins do not automatically share a wallet. Request persistent storage when supported, but explain that clearing site data, browser eviction, or losing a device can still erase cards. Installing the PWA is not a backup.

## MVP: file backup and restore

Export a JSON snapshot with a format version and a cards array (suggested filename: `wallet.memberships.json`). Download it or use the system share/save UI when available. Users can move the file to Google Drive, OneDrive, or iCloud Drive using their device's files app or the provider's website, then select it with the app's standard file picker to restore it. No provider SDK, credentials, or account setup is required by the app. A cloud folder can sync the backup **file**, not the browser's live wallet.

On restore, validate the version, size, and card fields before writing anything. Show a preview and ask before replacing an existing wallet; apply the replacement atomically so a failed import leaves the existing wallet intact. Treat imported values as data, not HTML. Tell users that exports are readable JSON containing their membership numbers and barcodes; do not log or send those values to analytics. Keep third-party scripts out of the core app and use a restrictive Content Security Policy.

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

1. **Wallet:** build the web UI, IndexedDB storage, and barcode display. Verify that card creation, editing, and deletion survive reloads without an account or network requests for card data.
2. **PWA and backup:** add installation, offline app shell, and export/restore. Test a first online load followed by offline use, a restore in a clean browser profile, and invalid imports leaving the existing wallet untouched. Check installation and file selection on representative Android, iOS, and desktop browsers.
3. **Cloud sync:** prototype one provider at a time. Verify account consent, token expiry, offline edits, conflicts between two devices, and disconnect/reconnect before rollout. Review whether users should be able to encrypt cloud snapshots before enabling sync.
