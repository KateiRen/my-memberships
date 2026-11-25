import type { Card, Location } from './model';

export const NEARBY_METRES = 200;
export const POSITION_MAX_AGE_MS = 60_000;
type Point = Pick<Location, 'latitude' | 'longitude'>;
export interface CurrentPosition extends Point { timestamp: number }
export class LocationError extends Error {
  constructor(public readonly code: 'locationDenied' | 'locationUnavailable' | 'locationTimeout' | 'locationImprecise') {
    super(code);
  }
}
export function distanceMetres(a: Point, b: Point): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const haversine = Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}
export function hasNearbyLocation(card: Pick<Card, 'locations'>, position: Point): boolean {
  return card.locations.some((location) => distanceMetres(location, position) <= NEARBY_METRES);
}
export function nearbyFirst(cards: Card[], position: Point | null): Card[] {
  if (!position) return cards;
  const nearby: Card[] = [];
  const other: Card[] = [];
  for (const card of cards) (hasNearbyLocation(card, position) ? nearby : other).push(card);
  return [...nearby, ...other];
}
export function requestPosition(): Promise<CurrentPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new LocationError('locationUnavailable')); return; }
    navigator.geolocation.getCurrentPosition(({ coords, timestamp }) => {
      if (!Number.isFinite(coords.latitude) || Math.abs(coords.latitude) > 90 ||
          !Number.isFinite(coords.longitude) || Math.abs(coords.longitude) > 180 ||
          !Number.isFinite(timestamp) || Date.now() - timestamp > POSITION_MAX_AGE_MS) {
        reject(new LocationError('locationUnavailable'));
      } else if (!Number.isFinite(coords.accuracy) || coords.accuracy < 0 || coords.accuracy > NEARBY_METRES) {
        reject(new LocationError('locationImprecise'));
      } else {
        resolve({ latitude: coords.latitude, longitude: coords.longitude, timestamp });
      }
    }, (error) => {
      reject(new LocationError(error.code === 1 ? 'locationDenied' : error.code === 3 ? 'locationTimeout' : 'locationUnavailable'));
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
  });
}
