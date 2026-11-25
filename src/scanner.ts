import { validateBarcode, type Card } from './model';
import type { BarcodeFormat as DecoderFormat } from '@zxing/library';

type Barcode = NonNullable<Card['barcode']>;
export type ScanError = 'cameraUnavailable' | 'cameraDenied' | 'scanFailed' | 'invalidBarcode';

export function startScanner(
  video: HTMLVideoElement,
  onResult: (barcode: Barcode) => void,
  onError: (error: ScanError) => void,
): () => void {
  let stopped = false;
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
  const fail = (error: ScanError) => {
    if (stopped) return;
    stop();
    onError(error);
  };
  void (async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fail('cameraUnavailable');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      if (stopped) { stop(); return; }
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => fail('cameraUnavailable')));
      const { createDecoder, BarcodeFormat, NotFoundException, ChecksumException, FormatException } = await import('./decoder');
      if (stopped) return;
      const formats = new Map<DecoderFormat, Barcode['format']>([
        [BarcodeFormat.CODE_128, 'code128'],
        [BarcodeFormat.EAN_13, 'ean13'],
        [BarcodeFormat.EAN_8, 'ean8'],
        [BarcodeFormat.QR_CODE, 'qrcode'],
      ]);
      video.srcObject = stream;
      await video.play();
      if (stopped) { stop(); return; }
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) { fail('scanFailed'); return; }
      const decode = createDecoder();
      const scan = () => {
        if (stopped) return;
        try {
          if (!video.videoWidth || !video.videoHeight) {
            timer = setTimeout(scan, 250);
            return;
          }
          const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const result = decode(context.getImageData(0, 0, canvas.width, canvas.height));
          const format = formats.get(result.getBarcodeFormat());
          if (!format) { fail('scanFailed'); return; }
          const barcode = { format, value: result.getText() };
          try { validateBarcode(barcode); }
          catch { fail('invalidBarcode'); return; }
          stop();
          onResult(barcode);
          return;
        } catch (error) {
          if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) {
            fail('scanFailed');
            return;
          }
        }
        timer = setTimeout(scan, 250);
      };
      scan();
    } catch (error) {
      fail(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'cameraDenied' : 'scanFailed');
    }
  })();
  return stop;
}
