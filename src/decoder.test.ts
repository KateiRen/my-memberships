import { expect, test } from 'vitest';
import sharp from 'sharp';
import { barcodeSvg, type BarcodeFormat } from './model';
import { createDecoder } from './decoder';

test.each([
  ['qrcode', '00042'],
  ['qrcode', ' https://example.test/card?number=00042\r\nMüller & Sons '],
  ['azteccode', ' 00 1234 é '],
  ['code128', ' 000123456789 '],
  ['code39', 'AB-00042'],
  ['ean13', '4006381333931'],
  ['ean8', '96385074'],
] satisfies [BarcodeFormat, string][])('decodes %s with its exact payload and format', async (format, value) => {
  const { data, info } = await sharp(Buffer.from(barcodeSvg({ format, value })))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = createDecoder()({ data: new Uint8ClampedArray(data), width: info.width, height: info.height });
  expect(result).toEqual({ format, value });
});

test('a frame without a code is not treated as a decoding failure', () => {
  expect(createDecoder()({ data: new Uint8ClampedArray(100 * 100 * 4).fill(255), width: 100, height: 100 })).toBeNull();
});
