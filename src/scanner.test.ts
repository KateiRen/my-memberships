import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startScanner } from './scanner';

beforeEach(() => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('HTMLVideoElement', class {
    srcObject = null;
    play = vi.fn(() => new Promise<void>(() => {}));
  });
});
afterEach(() => vi.unstubAllGlobals());

test('reports denied permission and requests only a rear-facing video stream', async () => {
  const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const onError = vi.fn();
  startScanner(new HTMLVideoElement(), vi.fn(), onError);
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('cameraDenied'));
  expect(getUserMedia).toHaveBeenCalledWith({
    audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
});

test('releases a stream that arrives after cancellation without reporting a result', async () => {
  let resolve!: (stream: MediaStream) => void;
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise<MediaStream>((done) => { resolve = done; }) } });
  const stop = vi.fn();
  vi.stubGlobal('MediaStream', class { getTracks() { return [{ stop }]; } });
  const onError = vi.fn();
  const onResult = vi.fn();
  const cancel = startScanner(new HTMLVideoElement(), onResult, onError);
  cancel();
  resolve(new MediaStream());
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(onError).not.toHaveBeenCalled();
  expect(onResult).not.toHaveBeenCalled();
});

test('hiding the app releases capture and reports that scanning paused', async () => {
  const stop = vi.fn();
  const track = Object.assign(new EventTarget(), { stop });
  vi.stubGlobal('MediaStream', class {
    getTracks() { return [track]; }
    getVideoTracks() { return [track]; }
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => new MediaStream() } });
  const video = new HTMLVideoElement();
  const onError = vi.fn();
  startScanner(video, vi.fn(), onError);
  await vi.waitFor(() => expect(video.srcObject).not.toBeNull());
  Object.defineProperty(document, 'hidden', { value: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(stop).toHaveBeenCalledOnce();
  expect(video.srcObject).toBeNull();
  expect(onError).toHaveBeenCalledWith('cameraPaused');
});
