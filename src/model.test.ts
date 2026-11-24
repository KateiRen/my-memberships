import { describe, expect, it } from 'vitest';
import { backupJson, barcodeSvg, parseBackup, sortCards, validateCard, type Card } from './model';

function exampleCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1', name: 'Bookshop', number: '001234', description: 'Local rewards', category: 'Shopping',
    addedAt: '2026-11-24T12:00:00.000Z', colors: ['#c5ed76', '#275c4b'],
    locations: [{ label: 'Main store', latitude: 52.52, longitude: 13.405 }, { label: 'Other store', latitude: -30, longitude: -70 }],
    barcode: { format: 'code128', value: '001234' }, ...overrides,
  };
}
describe('wallet data and backups', () => {
  it('round-trips every card field without losing leading zeros or dates', () => {
    const cards = [exampleCard()];
    expect(parseBackup(backupJson(cards))).toEqual(cards);
  });
  it.each([
    { version: 2, cards: [] },
    { version: 1, cards: [exampleCard(), exampleCard()] },
    { version: 1, cards: [exampleCard({ locations: [{ label: '', latitude: 91, longitude: 0 }] })] },
    { version: 1, cards: [exampleCard({ colors: ['red; background:url(x)', '#000000'] })] },
    { version: 1, cards: [exampleCard({ addedAt: 'not a date' })] },
  ])('rejects invalid snapshots before storage: %j', (data) => {
    expect(() => parseBackup(JSON.stringify({ format: 'my-memberships', ...data }))).toThrow();
  });
  it('rejects malformed, oversized, and unrelated files', () => {
    expect(() => parseBackup('{')).toThrow('invalidBackup');
    expect(() => parseBackup(' '.repeat(5 * 1024 * 1024 + 1))).toThrow('fileTooLarge');
    expect(() => parseBackup('{"cards":[]}')).toThrow('invalidBackup');
  });
  it('accepts empty backups and cards without optional content', () => {
    expect(parseBackup(backupJson([]))).toEqual([]);
    expect(validateCard(exampleCard({ description: '', category: '', locations: [], barcode: null })).barcode).toBeNull();
  });
  it('rejects wallet growth beyond the exportable size and unsafe route IDs', () => {
    const large = Array.from({ length: 2000 }, (_, index) => exampleCard({ id: `card-${index}`, description: 'é'.repeat(2000), barcode: null }));
    expect(() => backupJson(large)).toThrow('fileTooLarge');
    expect(() => validateCard(exampleCard({ id: 'card/#route' }))).toThrow('invalidCard');
  });
  it('filters names case-insensitively and sorts by locale without mutating input', () => {
    const cards = [exampleCard({ id: 'z', name: 'Zebra' }), exampleCard({ id: 'a', name: 'Äpfel' })];
    expect(sortCards(cards, 'de').map((card) => card.name)).toEqual(['Äpfel', 'Zebra']);
    expect(sortCards(cards, 'en', ' ZEB ').map((card) => card.id)).toEqual(['z']);
    expect(cards[0]?.id).toBe('z');
  });
});
describe('barcodes', () => {
  it.each([
    ['code128', '001234'], ['ean13', '4006381333931'], ['ean8', '96385074'], ['qrcode', 'membership:00123'],
  ] as const)('renders %s without remote requests', (format, value) => {
    expect(barcodeSvg({ format, value })).toContain('<svg');
  });
  it.each([
    ['ean13', '4006381333932'], ['ean13', '123'], ['ean8', '96385075'], ['code128', ''], ['code128', '🐈'],
    ['code128', 'a'.repeat(81)], ['qrcode', 'é'.repeat(513)],
  ] as const)('rejects invalid %s values instead of changing formats', (format, value) => {
    expect(() => barcodeSvg({ format, value })).toThrow('invalidBarcode');
  });
});
