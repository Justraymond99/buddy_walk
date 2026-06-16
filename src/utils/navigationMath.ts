import type { NavLatLng, NavRoute, NavStep } from '../types';

export function haversineMeters(a: NavLatLng, b: NavLatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
}

export function metersToFeetText(m: number): string {
  if (!Number.isFinite(m)) return '';
  if (m < 6) return 'a few feet';
  const ft = Math.round(m * 3.28084);
  if (ft < 100) return `${Math.round(ft / 5) * 5} feet`;
  return `${Math.round(ft / 10) * 10} feet`;
}

export function stepHasUsableCoords(s: NavStep | undefined): boolean {
  if (!s) return false;
  const { startLocation: a, endLocation: b } = s;
  return !(a.lat === 0 && a.lng === 0 && b.lat === 0 && b.lng === 0);
}

/**
 * True when the route's destination has a real coordinate (not the 0,0
 * placeholder used by text-parsed routes). Lets us confirm exact arrival by
 * GPS even when the individual steps lack coordinates.
 */
export function hasUsableDestination(route: NavRoute | null | undefined): boolean {
  const d = route?.destination;
  if (!d) return false;
  if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return false;
  return !(d.lat === 0 && d.lng === 0);
}
