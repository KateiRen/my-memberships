import { afterEach, expect, test, vi } from 'vitest';
import { distanceMetres, hasNearbyLocation, nearbyFirst, requestPosition } from './nearby';
import { sortCards, type Card } from './model';

const here = { latitude: 0, longitude: 0 };
const north = (metres: number) => ({ latitude: metres / 6_371_000 * 180 / Math.PI, longitude: 0 });
function card(id: string, locations: Card['locations'] = []): Card {
  return {
    id, name: id, locations, number: '0001', description: '', category: '',
    addedAt: '2026-11-24T12:00:00.000Z', colors: ['#112233', '#445566'], barcode: null,
  };
}
afterEach(() => vi.unstubAllGlobals());

test('uses the same 200-metre boundary for nearby suggestions and already-saved areas', () => {
  expect(hasNearbyLocation(card('inside', [{ label: '', ...north(199.9) }]), here)).toBe(true);
  expect(hasNearbyLocation(card('outside', [{ label: '', ...north(200.1) }]), here)).toBe(false);
  expect(hasNearbyLocation(card('multiple', [{ label: '', ...north(1000) }, { label: '', ...north(100) }]), here)).toBe(true);
  expect(distanceMetres(here, north(200))).toBeCloseTo(200, 6);
  expect(distanceMetres({ latitude: 0, longitude: 179.9995 }, { latitude: 0, longitude: -179.9995 })).toBeLessThan(200);
});

test('promotes all matching cards while retaining alphabetical search results without changing stored order', () => {
  const cards = [
    card('Zoo', [{ label: '', ...here }]), card('Alpha'),
    card('Market', [{ label: '', ...north(100) }]), card('Far away', [{ label: '', ...north(201) }]),
  ];
  expect(nearbyFirst(sortCards(cards, 'en'), here).map((item) => item.name)).toEqual(['Market', 'Zoo', 'Alpha', 'Far away']);
  expect(nearbyFirst(sortCards(cards, 'en', 'alpha'), here).map((item) => item.name)).toEqual(['Alpha']);
  expect(nearbyFirst(sortCards(cards, 'en'), null).map((item) => item.name)).toEqual(['Alpha', 'Far away', 'Market', 'Zoo']);
  expect(cards.map((item) => item.name)).toEqual(['Zoo', 'Alpha', 'Market', 'Far away']);
});

test.each([[1, 'locationDenied'], [2, 'locationUnavailable'], [3, 'locationTimeout']] as const)('reports geolocation error %s explicitly', async (code, expected) => {
  vi.stubGlobal('navigator', { geolocation: {
    getCurrentPosition: (_success: PositionCallback, error: (error: { code: number }) => void) => error({ code }),
  } });
  await expect(requestPosition()).rejects.toThrow(expected);
});

test('rejects imprecise fixes rather than saving or suggesting an unrelated area', async () => {
  vi.stubGlobal('navigator', { geolocation: {
    getCurrentPosition: (success: PositionCallback) => success({
      coords: { ...here, accuracy: 201, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
      timestamp: Date.now(), toJSON: () => ({}),
    }),
  } });
  await expect(requestPosition()).rejects.toThrow('locationImprecise');
});
