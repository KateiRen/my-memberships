import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { WalletStore } from './storage';
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
