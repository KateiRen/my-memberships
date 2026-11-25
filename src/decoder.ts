import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader';
import EAN13Reader from '@zxing/library/esm/core/oned/EAN13Reader';
import EAN8Reader from '@zxing/library/esm/core/oned/EAN8Reader';
import QRCodeReader from '@zxing/library/esm/core/qrcode/QRCodeReader';
import NotFoundException from '@zxing/library/esm/core/NotFoundException';
import ChecksumException from '@zxing/library/esm/core/ChecksumException';
import FormatException from '@zxing/library/esm/core/FormatException';
import BinaryBitmap from '@zxing/library/esm/core/BinaryBitmap';
import HybridBinarizer from '@zxing/library/esm/core/common/HybridBinarizer';
import RGBLuminanceSource from '@zxing/library/esm/core/RGBLuminanceSource';
import type { Reader, Result } from '@zxing/library';

export { default as BarcodeFormat } from '@zxing/library/esm/core/BarcodeFormat';
export { NotFoundException, ChecksumException, FormatException };

export function createDecoder(): (image: Pick<ImageData, 'data' | 'width' | 'height'>) => Result {
  const readers: Reader[] = [new QRCodeReader(), new Code128Reader(), new EAN13Reader(), new EAN8Reader()];
  return (image) => {
    const luminance = new Uint8ClampedArray(image.width * image.height);
    for (let pixel = 0; pixel < luminance.length; pixel++) {
      const offset = pixel * 4;
      luminance[pixel] = (image.data[offset]! + 2 * image.data[offset + 1]! + image.data[offset + 2]!) / 4;
    }
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, image.width, image.height)));
    for (const reader of readers) {
      try { return reader.decode(bitmap); }
      catch (error) {
        if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) throw error;
      } finally {
        reader.reset();
      }
    }
    throw new NotFoundException();
  };
}
