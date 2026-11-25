import { afterEach, expect, test, vi } from 'vitest';
import { startScanner } from './scanner';

afterEach(() => vi.unstubAllGlobals());

test('reports denied permission without starting decoding', async () => {
  const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const onError = vi.fn();
  startScanner({ srcObject: null } as HTMLVideoElement, vi.fn(), onError);
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('cameraDenied'));
  expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { facingMode: { ideal: 'environment' } } });
});

test('releases a camera stream that arrives after cancellation', async () => {
  let resolve!: (stream: MediaStream) => void;
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise<MediaStream>((done) => { resolve = done; }) } });
  const stop = vi.fn<MediaStreamTrack['stop']>();
  vi.stubGlobal('MediaStream', class { getTracks() { return [{ stop }]; } });
  const stream = new MediaStream();
  const onError = vi.fn();
  const onResult = vi.fn();
  const cancel = startScanner({ srcObject: null } as HTMLVideoElement, onResult, onError);
  cancel();
  resolve(stream);
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(onError).not.toHaveBeenCalled();
  expect(onResult).not.toHaveBeenCalled();
});
