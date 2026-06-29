import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@buddywalk:savedPlaces:v1';

export interface SavedPlace {
  id: string;
  alias: string;
  address: string;
  lat?: number;
  lon?: number;
  createdAt: string;
}

export interface SavePlaceInput {
  alias: string;
  address: string;
  lat?: number;
  lon?: number;
}

export interface ExpansionResult {
  text: string;
  matched: SavedPlace[];
}

export interface SavedPlacesStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

interface SavedPlacesStoreOptions {
  storage: SavedPlacesStorage;
  now?: () => Date;
  random?: () => number;
  warn?: (...args: unknown[]) => void;
}

function normalizeAlias(alias: string): string {
  return alias.trim().toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createSavedPlacesStore({
  storage,
  now = () => new Date(),
  random = Math.random,
  warn = console.warn,
}: SavedPlacesStoreOptions) {
  function genId(): string {
    return now().getTime().toString(36) + random().toString(36).slice(2, 8);
  }

  async function listSavedPlaces(): Promise<SavedPlace[]> {
    try {
      const raw = await storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (p): p is SavedPlace =>
          !!p &&
          typeof p.id === 'string' &&
          typeof p.alias === 'string' &&
          typeof p.address === 'string'
      );
    } catch (e) {
      warn('listSavedPlaces: bad storage payload', e);
      return [];
    }
  }

  async function writePlaces(places: SavedPlace[]): Promise<void> {
    await storage.setItem(STORAGE_KEY, JSON.stringify(places));
  }

  async function findPlaceByAlias(alias: string): Promise<SavedPlace | null> {
    const target = normalizeAlias(alias);
    if (!target) return null;
    const all = await listSavedPlaces();
    return all.find((p) => normalizeAlias(p.alias) === target) ?? null;
  }

  async function savePlace(input: SavePlaceInput): Promise<SavedPlace> {
    const alias = input.alias.trim();
    const address = input.address.trim();
    if (!alias) throw new Error('Alias is required');
    if (!address) throw new Error('Address is required');

    const existing = await listSavedPlaces();
    const conflicting = existing.find((p) => normalizeAlias(p.alias) === normalizeAlias(alias));
    const updated: SavedPlace = conflicting
      ? { ...conflicting, alias, address, lat: input.lat, lon: input.lon }
      : {
          id: genId(),
          alias,
          address,
          lat: input.lat,
          lon: input.lon,
          createdAt: now().toISOString(),
        };

    const next = conflicting
      ? existing.map((p) => (p.id === conflicting.id ? updated : p))
      : [...existing, updated];

    await writePlaces(next);
    return updated;
  }

  async function deletePlace(id: string): Promise<void> {
    const all = await listSavedPlaces();
    await writePlaces(all.filter((p) => p.id !== id));
  }

  async function expandSavedAliases(text: string): Promise<ExpansionResult> {
    const trimmed = text.trim();
    if (!trimmed) return { text: trimmed, matched: [] };
    const all = await listSavedPlaces();
    if (all.length === 0) return { text: trimmed, matched: [] };

    const sorted = [...all].sort((a, b) => b.alias.length - a.alias.length);
    const matched: SavedPlace[] = [];
    let result = trimmed;

    for (const place of sorted) {
      const aliasPattern = escapeRegex(place.alias.trim());
      if (!aliasPattern) continue;
      const re = new RegExp(`(^|[^A-Za-z0-9_])(${aliasPattern})(?=$|[^A-Za-z0-9_])`, 'gi');
      let didMatch = false;
      const replacement =
        place.lat != null && place.lon != null
          ? `${place.address} (coordinates ${place.lat}, ${place.lon})`
          : place.address;
      result = result.replace(re, (_fullMatch, prefix: string) => {
        didMatch = true;
        return `${prefix}${replacement}`;
      });
      if (didMatch) {
        matched.push(place);
      }
    }

    return { text: result.replace(/\s+/g, ' ').trim(), matched };
  }

  return {
    listSavedPlaces,
    findPlaceByAlias,
    savePlace,
    deletePlace,
    expandSavedAliases,
  };
}

const defaultStore = createSavedPlacesStore({ storage: AsyncStorage });

export const listSavedPlaces = defaultStore.listSavedPlaces;
export const findPlaceByAlias = defaultStore.findPlaceByAlias;
export const savePlace = defaultStore.savePlace;
export const deletePlace = defaultStore.deletePlace;
export const expandSavedAliases = defaultStore.expandSavedAliases;
