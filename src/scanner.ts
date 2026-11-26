import type { Card } from './model';

export type ScanError = 'cameraUnavailable' | 'cameraDenied' | 'scanFailed' | 'cameraPaused';

export function startScanner(
  video: HTMLVideoElement,
  onResult: (barcode: NonNullable<Card['barcode']>) => void,
  onError: (error: ScanError) => void,
): () => void {
  let stopped = false;
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', visibility);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
  const fail = (error: ScanError) => {
    if (stopped) return;
    stop();
    onError(error);
  };
  const visibility = () => { if (document.hidden) fail('cameraPaused'); };
  document.addEventListener('visibilitychange', visibility);
  void (async () => {
    if (document.hidden) { fail('cameraPaused'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { fail('cameraUnavailable'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (stopped) { stop(); return; }
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => fail('cameraUnavailable')));
      video.srcObject = stream;
      await video.play();
      const { createDecoder } = await import('./decoder');
      if (stopped) return;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) { fail('scanFailed'); return; }
      const decode = createDecoder();
      const scan = () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
            const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const result = decode(context.getImageData(0, 0, canvas.width, canvas.height));
            if (result) { stop(); onResult(result); return; }
          }
        } catch { fail('scanFailed'); return; }
        timer = setTimeout(scan, 250);
      };
      scan();
    } catch (error) {
      fail(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
        ? 'cameraDenied' : error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'NotReadableError')
          ? 'cameraUnavailable' : 'scanFailed');
    }
  })();
  return stop;
}
