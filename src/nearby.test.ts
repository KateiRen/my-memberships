import { afterEach, expect, test, vi } from 'vitest';
import { distanceMetres, hasNearbyLocation, nearbyCards, requestPosition, POSITION_WAIT_MS } from './nearby';
import { sortCards, type Card } from './model';

const here = { latitude: 0, longitude: 0 };
const north = (metres: number) => ({ latitude: metres / 6_371_000 * 180 / Math.PI, longitude: 0 });
function card(id: string, locations: Card['locations'] = []): Card {
  return {
    id, name: id, locations, number: '0001', description: '', category: '',
    addedAt: '2026-11-24T12:00:00.000Z', colors: ['#112233', '#445566'], barcode: null,
  };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('uses the same 200-metre boundary for nearby suggestions and already-saved areas', () => {
  expect(hasNearbyLocation(card('inside', [{ label: '', ...north(199.9) }]), here)).toBe(true);
  expect(hasNearbyLocation(card('outside', [{ label: '', ...north(200.1) }]), here)).toBe(false);
  expect(hasNearbyLocation(card('multiple', [{ label: '', ...north(1000) }, { label: '', ...north(100) }]), here)).toBe(true);
  expect(distanceMetres(here, north(200))).toBeCloseTo(200, 6);
  expect(distanceMetres({ latitude: 0, longitude: 179.9995 }, { latitude: 0, longitude: -179.9995 })).toBeLessThan(200);
});

test('selects all nearby cards in alphabetical search order without changing the full list', () => {
  const cards = [
    card('Zoo', [{ label: '', ...here }]), card('Alpha'),
    card('Market', [{ label: '', ...north(100) }]), card('Far away', [{ label: '', ...north(201) }]),
  ];
  const sorted = sortCards(cards, 'en');
  expect(nearbyCards(sorted, here).map((item) => item.name)).toEqual(['Market', 'Zoo']);
  expect(nearbyCards(sortCards(cards, 'en', 'alpha'), here)).toEqual([]);
  expect(nearbyCards(sorted, null)).toEqual([]);
  expect(sorted.map((item) => item.name)).toEqual(['Alpha', 'Far away', 'Market', 'Zoo']);
  expect(cards.map((item) => item.name)).toEqual(['Zoo', 'Alpha', 'Market', 'Far away']);
});

function mockWatch() {
  vi.useFakeTimers();
  let success!: PositionCallback;
  let failure!: (error: { code: number }) => void;
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((onSuccess: PositionCallback, onError: (error: { code: number }) => void) => {
    success = onSuccess;
    failure = onError;
    return 42;
  });
  vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } });
  const fix = (accuracy: number) => success({
    coords: { ...here, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
    timestamp: Date.now(), toJSON: () => ({}),
  });
  return { fix, failure: (code: number) => failure({ code }), watchPosition, clearWatch };
}

test('waits through an approximate first fix and stops immediately when accuracy improves', async () => {
  const { fix, watchPosition, clearWatch } = mockWatch();
  const request = requestPosition();
  fix(1500);
  await vi.advanceTimersByTimeAsync(5000);
  expect(clearWatch).not.toHaveBeenCalled();
  fix(200);
  await expect(request).resolves.toMatchObject(here);
  expect(watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
    enableHighAccuracy: true, maximumAge: 0, timeout: 15_000,
  });
  expect(clearWatch).toHaveBeenCalledExactlyOnceWith(42);
  expect(vi.getTimerCount()).toBe(0);
});

test('reports persistent imprecision after 15 seconds and stops watching', async () => {
  const { fix, clearWatch } = mockWatch();
  const result = expect(requestPosition()).rejects.toThrow('locationImprecise');
  fix(201);
  await vi.advanceTimersByTimeAsync(POSITION_WAIT_MS - 1);
  expect(clearWatch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await result;
  expect(clearWatch).toHaveBeenCalledExactlyOnceWith(42);
});

test.each([[1, 'locationDenied'], [2, 'locationUnavailable'], [3, 'locationTimeout']] as const)('reports geolocation error %s and cleans up the watch', async (code, expected) => {
  const { failure, clearWatch } = mockWatch();
  const result = expect(requestPosition()).rejects.toThrow(expected);
  failure(code);
  if (code !== 1) await vi.advanceTimersByTimeAsync(POSITION_WAIT_MS);
  await result;
  expect(clearWatch).toHaveBeenCalledExactlyOnceWith(42);
  expect(vi.getTimerCount()).toBe(0);
});

test('times out even if the device never supplies a callback', async () => {
  const { clearWatch } = mockWatch();
  const result = expect(requestPosition()).rejects.toThrow('locationTimeout');
  await vi.advanceTimersByTimeAsync(POSITION_WAIT_MS);
  await result;
  expect(clearWatch).toHaveBeenCalledExactlyOnceWith(42);
});

test('stops collecting location when the app is hidden and ignores late fixes', async () => {
  const { fix, clearWatch } = mockWatch();
  const document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', document);
  const result = expect(requestPosition()).rejects.toThrow('locationUnavailable');
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  fix(10);
  await result;
  expect(clearWatch).toHaveBeenCalledExactlyOnceWith(42);
  expect(vi.getTimerCount()).toBe(0);
});
