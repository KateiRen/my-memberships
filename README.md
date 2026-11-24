# My Memberships

A lightweight wallet for membership cards and their barcodes. The goal is a website you can also install as a Progressive Web App (PWA), with your cards available offline after the first visit.

**Status:** Design stage. There is no runnable app or deployment yet.

## Branding

- **Future app icon:** [Wallet with cards inside](assets/branding/Elegantes%20Lederkartenetui%20mit%20bunten%20Karten.png).
- **Website and in-app artwork:** [Cards fanned out of the wallet](assets/branding/F%C3%A4cher%20aus%20bunten%20Einkaufskarten.png).

Keep these original images as branding sources; generate app-icon sizes from the wallet image when implementing the PWA.

## Planned card details

Each membership card will store:

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
