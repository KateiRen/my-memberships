import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { validateCards, WalletError, type Language, type Snapshot } from './model';

export const CARD_DISPLAYS = ['standard', 'compact', 'list'] as const;
export type CardDisplay = typeof CARD_DISPLAYS[number];
export function isCardDisplay(value: unknown): value is CardDisplay {
  return CARD_DISPLAYS.some((display) => display === value);
}
interface WalletDB extends DBSchema {
  wallet: { key: string; value: Snapshot };
  preferences: { key: string; value: Language | boolean | CardDisplay };
}
export class WalletStore {
  private constructor(private readonly db: IDBPDatabase<WalletDB>) {}
  static async open(onUnavailable: () => void, name = 'my-memberships'): Promise<WalletStore> {
    let blocked = false;
    const db = await openDB<WalletDB>(name, 1, {
      upgrade(db) {
        db.createObjectStore('wallet');
        db.createObjectStore('preferences');
      },
      blocked() { blocked = true; onUnavailable(); },
      blocking() { db.close(); onUnavailable(); },
      terminated: onUnavailable,
    });
    if (blocked) { db.close(); throw new WalletError('storage'); }
    return new WalletStore(db);
  }
  async read(): Promise<Snapshot> {
    const snapshot = await this.db.get('wallet', 'current') ?? { revision: 0, cards: [] };
    return { revision: snapshot.revision, cards: validateCards(snapshot.cards) };
  }
  async replace(cards: unknown, expectedRevision: number): Promise<Snapshot> {
    const validated = validateCards(cards);
    const tx = this.db.transaction('wallet', 'readwrite');
    const current = await tx.store.get('current');
    if ((current?.revision ?? 0) !== expectedRevision) {
      await tx.done;
      throw new WalletError('conflict');
    }
    const next = { revision: expectedRevision + 1, cards: validated };
    await Promise.all([tx.store.put(next, 'current'), tx.done]);
    return next;
  }
  async language(): Promise<Language | undefined> {
    const value = await this.db.get('preferences', 'language');
    if (value !== undefined && value !== 'en' && value !== 'de') throw new WalletError('storage');
    return value;
  }
  async setLanguage(language: Language): Promise<void> { await this.db.put('preferences', language, 'language'); }
  async nearbyEnabled(): Promise<boolean | undefined> {
    const value = await this.db.get('preferences', 'nearby-enabled');
    if (value !== undefined && typeof value !== 'boolean') throw new WalletError('storage');
    return value;
  }
  async setNearbyEnabled(enabled: boolean): Promise<void> { await this.db.put('preferences', enabled, 'nearby-enabled'); }
  async cardDisplay(): Promise<CardDisplay> {
    const value = await this.db.get('preferences', 'card-display');
    if (value !== undefined) {
      if (!isCardDisplay(value)) throw new WalletError('storage');
      return value;
    }
    const legacy = await this.db.get('preferences', 'compact-cards');
    if (legacy !== undefined && typeof legacy !== 'boolean') throw new WalletError('storage');
    return legacy ? 'compact' : 'standard';
  }
  async setCardDisplay(display: CardDisplay): Promise<void> { await this.db.put('preferences', display, 'card-display'); }
  close(): void { this.db.close(); }
}
