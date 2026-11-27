import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { WalletStore } from './storage';
import { openDB } from 'idb';
import type { Card } from './model';

const card: Card = {
  id: 'first', name: 'Rewards', number: '0001', description: '', category: '',
  addedAt: '2026-11-24T12:00:00.000Z', colors: ['#112233', '#445566'], locations: [], barcode: null,
};
const connections: WalletStore[] = [];
async function open(name = crypto.randomUUID()): Promise<WalletStore> {
  const store = await WalletStore.open(() => { throw new Error('Unexpected database lifecycle failure'); }, name);
  connections.push(store);
  return store;
}
afterEach(() => { connections.splice(0).forEach((store) => store.close()); });
describe('transactional wallet storage', () => {
  it('remembers display choices independently of wallet replacement and other preferences', async () => {
    const name = crypto.randomUUID();
    const first = await open(name);
    expect(await first.cardDisplay()).toBe('standard');
    await first.setCardDisplay('compact');
    await first.setLanguage('de');
    await first.setNearbyEnabled(false);
    await first.replace([card], 0);
    first.close();
    const second = await open(name);
    expect(await second.cardDisplay()).toBe('compact');
    await second.setCardDisplay('list');
    await second.replace([], 1);
    expect(await second.cardDisplay()).toBe('list');
    expect(await second.language()).toBe('de');
    expect(await second.nearbyEnabled()).toBe(false);
    second.close();
    const third = await open(name);
    expect(await third.cardDisplay()).toBe('list');
    await third.setCardDisplay('standard');
    expect(await (await open(name)).cardDisplay()).toBe('standard');
  });
  it.each([true, false])('preserves the legacy compact preference %s until a new display is selected', async (legacy) => {
    const name = crypto.randomUUID();
    const store = await open(name);
    const db = await openDB(name, 1);
    try { await db.put('preferences', legacy, 'compact-cards'); } finally { db.close(); }
    expect(await store.cardDisplay()).toBe(legacy ? 'compact' : 'standard');
    await store.setCardDisplay('list');
    expect(await (await open(name)).cardDisplay()).toBe('list');
  });
  it.each(['card-display', 'compact-cards'])('reports invalid stored %s values', async (key) => {
    const name = crypto.randomUUID();
    const store = await open(name);
    const db = await openDB(name, 1);
    try { await db.put('preferences', 'invalid', key); } finally { db.close(); }
    await expect(store.cardDisplay()).rejects.toThrow('storage');
  });
  it('remembers both location opt-in and refusal independently from wallet replacement and language', async () => {
    const name = crypto.randomUUID();
    const first = await open(name);
    expect(await first.nearbyEnabled()).toBeUndefined();
    await first.setLanguage('de');
    await first.setNearbyEnabled(false);
    await first.replace([card], 0);
    first.close();
    const second = await open(name);
    expect(await second.nearbyEnabled()).toBe(false);
    expect(await second.language()).toBe('de');
    await second.setNearbyEnabled(true);
    await second.replace([], 1);
    second.close();
    expect(await (await open(name)).nearbyEnabled()).toBe(true);
  });
  it('persists cards and language after reopening, and supports edits and deletion', async () => {
    const name = crypto.randomUUID();
    const first = await open(name);
    await first.replace([card], 0);
    await first.setLanguage('de');
    first.close();
    const second = await open(name);
    expect(await second.read()).toEqual({ revision: 1, cards: [card] });
    expect(await second.language()).toBe('de');
    await second.replace([{ ...card, name: 'Changed' }], 1);
    expect((await second.read()).cards[0]?.name).toBe('Changed');
    await second.replace([], 2);
    expect((await second.read()).cards).toEqual([]);
  });
  it('rejects a stale-tab save or restore without overwriting newer data', async () => {
    const name = crypto.randomUUID();
    const first = await open(name);
    const second = await open(name);
    await first.replace([card], 0);
    await expect(second.replace([], 0)).rejects.toThrow('conflict');
    expect((await second.read()).cards).toEqual([card]);
  });
  it('leaves the entire existing wallet intact when a restore has invalid cards', async () => {
    const store = await open();
    await store.replace([card], 0);
    await expect(store.replace([card, { ...card, id: 'bad', number: 123 }], 1)).rejects.toThrow('invalidCard');
    expect(await store.read()).toEqual({ revision: 1, cards: [card] });
  });
  it('serializes competing writes; exactly one revision wins', async () => {
    const store = await open();
    const results = await Promise.allSettled([store.replace([card], 0), store.replace([], 0)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await store.read()).revision).toBe(1);
  });
});
