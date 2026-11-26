import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader';
import Code39Reader from '@zxing/library/esm/core/oned/Code39Reader';
import EAN13Reader from '@zxing/library/esm/core/oned/EAN13Reader';
import EAN8Reader from '@zxing/library/esm/core/oned/EAN8Reader';
import QRCodeReader from '@zxing/library/esm/core/qrcode/QRCodeReader';
import AztecReader from '@zxing/library/esm/core/aztec/AztecReader';
import NotFoundException from '@zxing/library/esm/core/NotFoundException';
import ChecksumException from '@zxing/library/esm/core/ChecksumException';
import FormatException from '@zxing/library/esm/core/FormatException';
import BinaryBitmap from '@zxing/library/esm/core/BinaryBitmap';
import HybridBinarizer from '@zxing/library/esm/core/common/HybridBinarizer';
import RGBLuminanceSource from '@zxing/library/esm/core/RGBLuminanceSource';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat';
import StringEncoding from '@zxing/library/esm/core/util/StringEncoding';
import type { Reader } from '@zxing/library';
import type { Card } from './model';

const formats = new Map<BarcodeFormat, NonNullable<Card['barcode']>['format']>([
  [BarcodeFormat.CODE_128, 'code128'],
  [BarcodeFormat.CODE_39, 'code39'],
  [BarcodeFormat.EAN_13, 'ean13'],
  [BarcodeFormat.EAN_8, 'ean8'],
  [BarcodeFormat.QR_CODE, 'qrcode'],
  [BarcodeFormat.AZTEC, 'azteccode'],
] as const);

export function createDecoder(): (image: Pick<ImageData, 'data' | 'width' | 'height'>) => Card['barcode'] {
  StringEncoding.customDecoder = (bytes, encoding) => encoding === 'ISO-8859-1'
    ? Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
    : new TextDecoder(encoding, { fatal: true }).decode(bytes);
  const readers: Reader[] = [new QRCodeReader(), new AztecReader(), new Code128Reader(), new Code39Reader(), new EAN13Reader(), new EAN8Reader()];
  return (image) => {
    const luminance = new Uint8ClampedArray(image.width * image.height);
    for (let pixel = 0; pixel < luminance.length; pixel++) {
      const offset = pixel * 4;
      luminance[pixel] = (image.data[offset]! + 2 * image.data[offset + 1]! + image.data[offset + 2]!) / 4;
    }
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, image.width, image.height)));
    for (const reader of readers) {
      try {
        const result = reader.decode(bitmap);
        const format = formats.get(result.getBarcodeFormat());
        if (!format) throw new Error('Unsupported barcode format');
        let value = result.getText();
        if (format === 'azteccode') {
          // This reader exposes Aztec binary text as Latin-1; prefer valid UTF-8.
          try { value = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(value, (char) => char.charCodeAt(0))); }
          catch (error) { if (!(error instanceof TypeError)) throw error; }
        }
        return { format, value };
      } catch (error) {
        if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) throw error;
      } finally { reader.reset(); }
    }
    return null;
  };
}
