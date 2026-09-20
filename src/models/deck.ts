import type { CardDetection } from "./detection.ts";

export type DeckLine = {
  name: string;
  count: number;
};

export type Decklist = {
  lines: DeckLine[];
  unresolved: CardDetection[];
  total: number;
};

const BASIC_LANDS = new Set([
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
  "Wastes",
  "Snow-Covered Plains",
  "Snow-Covered Island",
  "Snow-Covered Swamp",
  "Snow-Covered Mountain",
  "Snow-Covered Forest",
  "Snow-Covered Wastes",
]);

export function isBasicLand(name: string | undefined): boolean {
  return Boolean(name && BASIC_LANDS.has(name));
}

function landSortKey(name: string): number {
  return BASIC_LANDS.has(name) ? 1 : 0;
}

export function buildDecklist(detections: CardDetection[]): Decklist {
  const counts = new Map<string, number>();
  const unresolved: CardDetection[] = [];

  for (const detection of detections) {
    if (detection.count === 0) continue;
    if (detection.name && detection.status !== "unknown") {
      const copies = detection.count ?? 1;
      counts.set(detection.name, (counts.get(detection.name) ?? 0) + copies);
    } else {
      unresolved.push(detection);
    }
  }

  const lines = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      const landDiff = landSortKey(a.name) - landSortKey(b.name);
      if (landDiff !== 0) return landDiff;
      return a.name.localeCompare(b.name);
    });

  const total = lines.reduce((sum, line) => sum + line.count, 0);

  return { lines, unresolved, total };
}

export function formatDecklistText(decklist: Decklist): string {
  const named = decklist.lines.map((line) => `${line.count} ${line.name}`);
  const unknown = decklist.unresolved.map(
    (card) => `1 ${card.detectedText || "Unknown card"}`,
  );
  return [...named, ...unknown].join("\n");
}

export function formatDecklistJson(decklist: Decklist): string {
  return JSON.stringify(
    {
      cards: decklist.lines,
      unresolved: decklist.unresolved.map((card) => ({
        detectedText: card.detectedText,
        confidence: card.confidence,
      })),
      total: decklist.total,
      unresolvedCount: decklist.unresolved.length,
    },
    null,
    2,
  );
}
