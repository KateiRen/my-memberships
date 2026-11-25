import { expect, test } from 'vitest';
import sharp from 'sharp';
import { barcodeSvg, type BarcodeFormat } from './model';
import { createDecoder, BarcodeFormat as DecoderFormat } from './decoder';

test.each([
  ['qrcode', 'https://example.test/card?number=00042', DecoderFormat.QR_CODE],
  ['code128', '000123456789', DecoderFormat.CODE_128],
  ['ean13', '4006381333931', DecoderFormat.EAN_13],
  ['ean8', '96385074', DecoderFormat.EAN_8],
] satisfies [BarcodeFormat, string, DecoderFormat][])('decodes %s with its exact format and value', async (format, value, expectedFormat) => {
  const { data, info } = await sharp(Buffer.from(barcodeSvg({ format, value }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = createDecoder()({ data: new Uint8ClampedArray(data), width: info.width, height: info.height });
  expect(result.getText()).toBe(value);
  expect(result.getBarcodeFormat()).toBe(expectedFormat);
});
