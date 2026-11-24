# My Memberships

A lightweight wallet for membership cards and their barcodes. The goal is a website you can also install as a Progressive Web App (PWA), with your cards available offline after the first visit.

**Status:** Design stage. There is no runnable app or deployment yet.

## Where your cards will live

The app will keep cards in your browser on each device, with no My Memberships account or hosted wallet database. Browser storage can be cleared, so the first version will include backup and restore using a file you control. You can save that file in Google Drive, OneDrive, or iCloud Drive and import it on another device. Saving a file there is a backup, not automatic wallet sync.

Direct Google Drive and OneDrive sync are possible later, with optional sign-in to the provider you choose. iCloud Drive is planned as a manual file option.

See [Architecture.md](Architecture.md) for the design and development milestones. This project is licensed under the [MIT License](LICENSE).
