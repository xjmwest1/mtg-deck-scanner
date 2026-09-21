import { describe, expect, it } from "vitest";
import { matchCardName } from "./fuzzyMatch.ts";
import type { CardIndex } from "./cardIndex.ts";
import { normalizeCardName, splitFaces } from "./normalize.ts";

function makeIndex(names: string[]): CardIndex {
  const byNormalized = new Map<string, string>();
  const cards = [];
  for (const name of names) {
    const normalized = normalizeCardName(name);
    cards.push({ name, searchName: name, normalized });
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, name);
  }
  for (const name of names) {
    for (const searchName of splitFaces(name)) {
      if (searchName === name) continue;
      const normalized = normalizeCardName(searchName);
      cards.push({ name, searchName, normalized });
      if (!byNormalized.has(normalized)) byNormalized.set(normalized, name);
    }
  }
  return { cards, names, byNormalized };
}

describe("matchCardName", () => {
  const index = makeIndex([
    "Lightning Bolt",
    "Lightning Strike",
    "Scorching Dragonfire",
    "Frost Lynx",
    "Frost Titan",
    "Wear // Tear",
  ]);

  it("matches noisy OCR to the closest card name", () => {
    const result = matchCardName(index, "Scorchlng Dragonflre", 0.91);
    expect(result.best?.name).toBe("Scorching Dragonfire");
    expect(result.best?.score ?? 0).toBeGreaterThan(0.7);
  });

  it("keeps nearby alternatives for correction", () => {
    const result = matchCardName(index, "Frost Lyny", 0.8);
    expect(result.best?.name).toBe("Frost Lynx");
    expect(result.matches.map((match) => match.name)).toContain("Frost Titan");
  });

  it("maps a split-card face back to the full name", () => {
    const result = matchCardName(index, "Wear", 0.95);
    expect(result.best?.name).toBe("Wear // Tear");
  });

  it("prefers a standalone card over a split face with the same name", () => {
    const mixed = makeIndex([
      "Emeritus of Conflict // Lightning Bolt",
      "Lightning Bolt",
    ]);
    const result = matchCardName(mixed, "Lightning Bolt", 0.95);
    expect(result.best?.name).toBe("Lightning Bolt");
  });

  it("recovers the full name from a truncated first word", () => {
    const lands = makeIndex([
      "Grotag Bug-Catcher",
      "Grotag Siege-Runner",
      "Goblin Matron",
    ]);
    const result = matchCardName(lands, "Grotag", 0.9);
    expect(result.best?.name).toBe("Grotag Bug-Catcher");
    expect(result.best?.score ?? 0).toBeGreaterThan(0.58);
  });

  it("matches garbled land title OCR to the printed name", () => {
    const lands = makeIndex([
      "Sacred Foundry",
      "Sacred Cat",
      "Battlefield Forge",
      "Grand Coliseum",
      "Ghitu Encampment",
      "Sulfurous Springs",
      "Arid Mesa",
    ]);
    expect(matchCardName(lands, "sacred foundary", 0.85).best?.name).toBe(
      "Sacred Foundry",
    );
    expect(matchCardName(lands, "Sacred Foi", 0.85).best?.name).toBe("Sacred Foundry");
    expect(matchCardName(lands, "Batrkfe Forgs", 0.85).best?.name).toBe(
      "Battlefield Forge",
    );
    expect(matchCardName(lands, "grand celiscum", 0.8).best?.name).toBe(
      "Grand Coliseum",
    );
  });

  it("matches garbled multi-word titles", () => {
    const index = makeIndex([
      "White Mage's Staff",
      "White Knight",
      "Red Mage's Rapier",
      "Steelshaper's Gift",
      "Grotag Bug-Catcher",
      "Squad Commander",
      "Sacred Foundry",
      "Sacred Fire",
      "Sleep",
      "Soul Echo",
      "Archpriest of Iona",
      "Barrier of Bones",
      "Arashin Foremost",
      "Rebel Informer",
      "Arc Lightning",
      "High Noon",
      "Pardic Miner",
      "Chief of the Edge",
      "Over the Edge",
      "Ardent Electromancer",
    ]);
    expect(matchCardName(index, "white Mage's Sraf", 0.85).best?.name).toBe(
      "White Mage's Staff",
    );
    expect(matchCardName(index, "Slecbhup", 0.7).best?.name).toBe("Steelshaper's Gift");
    expect(matchCardName(index, "Sepaad Comenaler", 0.64).best?.name).toBe(
      "Squad Commander",
    );
    expect(
      matchCardName(index, "Sacred Foi", 0.96, { preferLands: true }).best?.name,
    ).toBe("Sacred Foundry");
    expect(matchCardName(index, "Ainhpriest of bone", 0.69).best?.name).toBe(
      "Archpriest of Iona",
    );
    expect(matchCardName(index, "Aresbin forro", 0.59).best?.name).toBe("Arashin Foremost");
    expect(matchCardName(index, "Are Uighinin", 0.85).best?.name).toBe("Arc Lightning");
    expect(matchCardName(index, "Chiefor the Fdge", 0.88).best?.name).toBe(
      "Chief of the Edge",
    );
  });

  it("recovers garbled overlapping titles from a white-aggro scan", () => {
    const index = makeIndex([
      "Flickerwisp",
      "Flickerform",
      "Inti, Seneschal of the Sun",
      "Inti Corrupter",
      "Laelia, the Blade Reforged",
      "Little Girl",
      "Treasure",
      "Treasure Cruise",
      "Treasury Thrull",
      "Mother of Runes",
      "Student of Warfare",
      "Thalia, Guardian of Thraben",
      "Adeline, Resplendent Cathar",
      "Cosmogrand Zenith",
      "Ghostfire Slice",
      "Flametongue Kavu",
      "Nova Hellkite",
      "Goblin Rabblemaster",
      "Swords to Plowshares",
      "Earthshaker Khenra",
      "Mountain",
      "Lightning Bolt",
    ]);
    expect(matchCardName(index, "Fickerwine", 0.8).best?.name).toBe("Flickerwisp");
    expect(matchCardName(index, "l. Senee hal ef the", 0.75).best?.name).toBe(
      "Inti, Seneschal of the Sun",
    );
    expect(matchCardName(index, "Laetle he m", 0.7).best?.name).toBe(
      "Laelia, the Blade Reforged",
    );
    expect(matchCardName(index, "TUEASURI", 0.7).best?.name).not.toBe("Treasury Thrull");
    expect(matchCardName(index, "TUEASURI", 0.7).matches).toHaveLength(0);
    expect(matchCardName(index, "Gablin", 0.75).best?.name).toBe("Goblin Rabblemaster");
    expect(matchCardName(index, "Alrlinr", 0.7).best?.name).toBe("Adeline, Resplendent Cathar");
    expect(matchCardName(index, "s ro plowshares", 0.82).best?.name).toBe("Swords to Plowshares");
    expect(matchCardName(index, "Larthshaker Khenra", 0.9).best?.name).toBe("Earthshaker Khenra");
    expect(matchCardName(index, "Ghosifir", 0.7).best?.name).toBe("Ghostfire Slice");
  });
});
