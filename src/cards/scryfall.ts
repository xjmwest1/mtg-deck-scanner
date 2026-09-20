import { explainFetchError } from "../lib/errors.ts";

const SCRYFALL_CARD_NAMES_URL = "https://api.scryfall.com/catalog/card-names";

export async function fetchOracleCardNames(): Promise<string[]> {
  try {
    const response = await fetch(SCRYFALL_CARD_NAMES_URL, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Could not load Scryfall card names (${response.status}).`);
    }

    const payload = (await response.json()) as { data?: unknown };
    if (!Array.isArray(payload.data) || payload.data.some((name) => typeof name !== "string")) {
      throw new Error("Scryfall card-name catalog was malformed.");
    }

    return payload.data as string[];
  } catch (error) {
    throw explainFetchError("Magic card names", error);
  }
}

export async function fetchLocalCardNames(): Promise<string[] | null> {
  try {
    const response = await fetch("/card-names.json");
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: unknown };
    if (!Array.isArray(payload.data) || payload.data.some((name) => typeof name !== "string")) {
      return null;
    }
    return payload.data as string[];
  } catch {
    return null;
  }
}
