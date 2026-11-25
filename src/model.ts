import { code128, ean13, ean8, qrcode, drawingSVG } from 'bwip-js/browser';

export const FORMATS = ['code128', 'ean13', 'ean8', 'qrcode'] as const;
export type BarcodeFormat = typeof FORMATS[number];
export type Language = 'en' | 'de';
export interface Location { label: string; latitude: number; longitude: number }
export interface Card {
  id: string;
  name: string;
  number: string;
  description: string;
  category: string;
  addedAt: string;
  colors: [string, string];
  locations: Location[];
  barcode: { format: BarcodeFormat; value: string } | null;
}
export interface Snapshot { revision: number; cards: Card[] }
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const MAX_CARDS = 2000;
export class WalletError extends Error {
  constructor(public readonly code: 'invalidCard' | 'invalidBarcode' | 'invalidBackup' | 'conflict' | 'storage' | 'fileTooLarge' | 'tooManyCards') {
    super(code);
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number, required = false): value is string {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
}
export function validateBarcode(barcode: NonNullable<Card['barcode']>): void {
  if (!FORMATS.includes(barcode.format) || !text(barcode.value, 1024, true)) throw new WalletError('invalidBarcode');
  if (barcode.format === 'qrcode' && new TextEncoder().encode(barcode.value).length > 1024) throw new WalletError('invalidBarcode');
  if (barcode.format === 'code128' && (!/^[\x20-\x7e]+$/.test(barcode.value) || barcode.value.length > 80)) throw new WalletError('invalidBarcode');
  if (barcode.format === 'ean13' || barcode.format === 'ean8') {
    const digits = barcode.format === 'ean13' ? 13 : 8;
    if (!new RegExp(`^\\d{${digits}}$`).test(barcode.value)) throw new WalletError('invalidBarcode');
    let sum = 0;
    for (let index = 0; index < digits; index++) {
      sum += Number(barcode.value[index]) * ((digits - index) % 2 === 0 ? 3 : 1);
    }
    if (sum % 10 !== 0) throw new WalletError('invalidBarcode');
  }
}
export function barcodeSvg(barcode: NonNullable<Card['barcode']>): string {
  validateBarcode(barcode);
  try {
    const render = { code128, ean13, ean8, qrcode }[barcode.format];
    return render({
      bcid: barcode.format, text: barcode.value, scale: 3,
      ...(barcode.format === 'qrcode' ? {} : { height: 18 }),
      includetext: false, padding: 12, backgroundcolor: 'FFFFFF', barcolor: '000000',
    }, drawingSVG());
  } catch {
    throw new WalletError('invalidBarcode');
  }
}
export function validateCard(value: unknown): Card {
  if (!record(value) || !text(value.id, 100, true) || !/^[a-zA-Z0-9_-]+$/.test(value.id) || !text(value.name, 100, true) ||
      !text(value.number, 200, true) || !text(value.description, 2000) || !text(value.category, 60) ||
      typeof value.addedAt !== 'string' || !Number.isFinite(Date.parse(value.addedAt)) ||
      new Date(value.addedAt).toISOString() !== value.addedAt ||
      !Array.isArray(value.colors) || value.colors.length !== 2 ||
      !value.colors.every((c: unknown) => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c)) ||
      !Array.isArray(value.locations) || value.locations.length > 50) throw new WalletError('invalidCard');
  const locations: Location[] = value.locations.map((location: unknown) => {
    if (!record(location) || !text(location.label, 150) ||
        typeof location.latitude !== 'number' || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
        typeof location.longitude !== 'number' || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) {
      throw new WalletError('invalidCard');
    }
    return { label: location.label, latitude: location.latitude, longitude: location.longitude };
  });
  let barcode: Card['barcode'] = null;
  if (value.barcode !== null) {
    const source = value.barcode;
    if (!record(source) || typeof source.format !== 'string' || !text(source.value, 1024, true)) {
      throw new WalletError('invalidBarcode');
    }
    const format = FORMATS.find((format) => format === source.format);
    if (!format) throw new WalletError('invalidBarcode');
    barcode = { format, value: source.value };
    validateBarcode(barcode);
  }
  return {
    id: value.id, name: value.name, number: value.number, description: value.description,
    category: value.category, addedAt: value.addedAt, colors: [value.colors[0], value.colors[1]],
    locations, barcode,
  };
}
export function validateCards(values: unknown): Card[] {
  if (!Array.isArray(values)) throw new WalletError('invalidBackup');
  if (values.length > MAX_CARDS) throw new WalletError('tooManyCards');
  const cards = values.map(validateCard);
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new WalletError('invalidBackup');
  if (new TextEncoder().encode(snapshotJson(cards)).length > MAX_BACKUP_BYTES) throw new WalletError('fileTooLarge');
  return cards;
}
export function parseBackup(source: string): Card[] {
  if (new TextEncoder().encode(source).length > MAX_BACKUP_BYTES) throw new WalletError('fileTooLarge');
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new WalletError('invalidBackup'); }
  if (!record(value) || value.format !== 'my-memberships' || value.version !== 1) throw new WalletError('invalidBackup');
  return validateCards(value.cards);
}
function snapshotJson(cards: Card[]): string { return JSON.stringify({ format: 'my-memberships', version: 1, cards }); }
export function backupJson(cards: Card[]): string { return snapshotJson(validateCards(cards)); }
export function sortCards(cards: Card[], language: Language, search = ''): Card[] {
  const query = search.trim().toLocaleLowerCase(language);
  return cards.filter((card) => card.name.toLocaleLowerCase(language).includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}
