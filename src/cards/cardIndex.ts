import { normalizeCardName, splitFaces } from "./normalize.ts";
import { fetchLocalCardNames, fetchOracleCardNames } from "./scryfall.ts";

export type IndexedCard = {
  name: string;
  searchName: string;
  normalized: string;
};

export type CardIndex = {
  cards: IndexedCard[];
  names: string[];
  byNormalized: Map<string, string>;
};

const CACHE_KEY = "mtg-card-names-v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedCatalog = {
  fetchedAt: number;
  names: string[];
};

let indexPromise: Promise<CardIndex> | null = null;

export function loadCardIndex(): Promise<CardIndex> {
  if (!indexPromise) {
    indexPromise = buildIndex().catch((error: unknown) => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}

async function buildIndex(): Promise<CardIndex> {
  const names = await loadCardNames();
  const byNormalized = new Map<string, string>();
  const cards: IndexedCard[] = [];

  for (const name of names) {
    const normalized = normalizeCardName(name);
    if (!normalized) continue;
    cards.push({ name, searchName: name, normalized });
    if (!byNormalized.has(normalized)) {
      byNormalized.set(normalized, name);
    }
  }

  for (const name of names) {
    for (const searchName of splitFaces(name)) {
      if (searchName === name) continue;
      const normalized = normalizeCardName(searchName);
      if (!normalized) continue;
      cards.push({ name, searchName, normalized });
      if (!byNormalized.has(normalized)) {
        byNormalized.set(normalized, name);
      }
    }
  }

  return { cards, names, byNormalized };
}

async function loadCardNames(): Promise<string[]> {
  const cached = readCache();
  if (cached) return cached;

  try {
    const names = await fetchOracleCardNames();
    writeCache(names);
    return names;
  } catch (error) {
    const local = await fetchLocalCardNames();
    if (local) {
      writeCache(local);
      return local;
    }
    throw error;
  }
}

function readCache(): string[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCatalog;
    if (!Array.isArray(parsed.names) || typeof parsed.fetchedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.names;
  } catch {
    return null;
  }
}

function writeCache(names: string[]): void {
  try {
    const payload: CachedCatalog = { fetchedAt: Date.now(), names };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota errors; the in-memory index is enough for this session.
  }
}
