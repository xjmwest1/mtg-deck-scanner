import type { OCRRegion } from "../models/detection.ts";

// A card title is a short, big-font string. Rules text, type lines, and
// collector/set lines are smaller, wider, wordier, and littered with
// punctuation or digits. Geometry stays permissive so real (but short /
// truncated) titles are not dropped; body copy is screened by content and
// by column layout in the scan pipeline.
const MIN_LETTERS = 2;
const MIN_WIDTH = 18;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 140;
const MAX_TEXT_LENGTH = 48;
const MAX_WORDS = 6;
const MAX_ASPECT = 7.5;
const MAX_ASPECT_SHORT_TITLE = 12;
const TITLE_SHORT_WORDS = new Set(["of", "the", "to", "a", "an", "in", "on", "or"]);
const MAX_LETTER_DENSITY = 0.45;
const MAX_NON_LETTER_RATIO = 0.4;
const MAX_ANGLE = 38;

const TYPE_LINE_WORDS = [
  "creature",
  "instant",
  "sorcery",
  "enchantment",
  "artifact",
  "legendary",
  "planeswalker",
  "battle",
  "land",
  "basic",
  "snow",
  "tribal",
  "kindred",
  "aura",
  "equipment",
  "vehicle",
  "human",
  "wizard",
  "warrior",
  "cleric",
  "goblin",
  "elf",
  "zombie",
  "soldier",
  "knight",
  "shaman",
  "rogue",
  "ally",
  "berserker",
  "monk",
  "dragon",
  "angel",
  "demon",
  "spirit",
  "beast",
  "elemental",
  "advisor",
  "mercenary",
];

export function selectTitleCandidates(regions: OCRRegion[]): OCRRegion[] {
  const kept = regions.filter((region) => isLikelyTitle(region));
  return mergeLineFragments(kept).filter((region) => isLikelyTitle(region));
}

export function titleFilterReason(region: OCRRegion): string | null {
  const text = sanitizeOcrText(region.text);
  const letters = countLetters(text);
  if (letters < MIN_LETTERS) return `too few letters (${letters})`;
  if (text.length > MAX_TEXT_LENGTH) return `text too long (${text.length})`;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > MAX_WORDS) return `too many words (${words.length})`;

  const { width, height } = region.boundingBox;
  if (width < MIN_WIDTH) return `too narrow (${Math.round(width)}px)`;
  if (height < MIN_HEIGHT) return `too short (${Math.round(height)}px)`;
  if (height > MAX_HEIGHT) return `too tall (${Math.round(height)}px)`;

  const aspect = width / Math.max(1, height);
  const aspectLimit = words.length <= 4 ? MAX_ASPECT_SHORT_TITLE : MAX_ASPECT;
  if (aspect > aspectLimit) return `too wide (aspect ${aspect.toFixed(1)})`;

  const density = letters / Math.max(1, width);
  if (density > MAX_LETTER_DENSITY) return `text too dense (${density.toFixed(2)})`;

  const why = bodyTextReason(text);
  if (why) return why;

  if (words.length === 1 && letters <= 4 && height <= 9 && width <= 40) {
    return "too short to be a title alone";
  }

  const compact = text.replace(/\s+/g, "");
  const nonLetters = compact.length - countLetters(text);
  if (compact.length > 0 && nonLetters / compact.length > MAX_NON_LETTER_RATIO) {
    return "mostly non-letters";
  }

  const angle = polygonAngle(region);
  if (Math.abs(angle) > MAX_ANGLE) return `too rotated (${Math.round(angle)}°)`;
  return null;
}

export function bodyTextReason(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty";

  if (/[+=/]/.test(trimmed)) return "contains a rules symbol";
  if (/[—–]|\s-\s/.test(trimmed)) return "looks like a type line (dash)";
  if (/^[:;"'.,()[\]{}@]/.test(trimmed)) return "leading punctuation";
  if (/[.!?]$/.test(trimmed)) return "sentence punctuation";
  if (/^(?:[ptwueq]|tap)\s*[,:]/i.test(trimmed)) return "activation cost";
  if (countDigits(trimmed) >= 2) return "looks like rules/collector text (digits)";

  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length <= 3 && countDigits(trimmed) > 0) {
    return "collector/mana fragment";
  }
  if (compact.length <= 3 && /[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed)) {
    return "mixed-case fragment";
  }

  if (compact.length <= 5 && /\d/.test(trimmed) && /[a-z]/i.test(trimmed)) {
    return "alphanumeric fragment";
  }
  if (/^anifact\b/i.test(trimmed)) return "looks like a type line";

  if (/\badd\b/i.test(trimmed) || /\bald one\b/i.test(trimmed)) return "mana ability";
  if (/\b(enten|becomes|tapped|battlefield|turn|strike|token)\b/i.test(trimmed)) {
    return "rules phrase";
  }
  if (/\b(deals?|damage|danage|tapped|untap|target|copy)\b/i.test(trimmed)) {
    return "rules phrase";
  }
  if (/\b(you|your)\b/i.test(trimmed) && /\b(control|life|mana|pool)\b/i.test(trimmed)) {
    return "rules phrase";
  }
  if (/\b(may pay|controller|coetroller|permanent)\b/i.test(trimmed)) {
    return "rules phrase";
  }
  if (
    /\bthis\b/i.test(trimmed) &&
    /\b(art|creat|enchant|land|perman|equip|instant|sorcery)\b/i.test(trimmed)
  ) {
    return "rules phrase";
  }
  if (/\bcard types\b/i.test(trimmed) || (/\bmore\b/i.test(trimmed) && /\bcards?\b/i.test(trimmed))) {
    return "rules phrase";
  }
  if (junkShortWordCount(trimmed) >= 3) return "garbled fragment";
  if (typeLineHits(trimmed) >= 2) return "looks like a type line";
  return null;
}

function junkShortWordCount(text: string): number {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length <= 2 && !TITLE_SHORT_WORDS.has(word)).length;
}

function typeLineHits(text: string): number {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3);
  let hits = 0;
  for (const word of words) {
    if (TYPE_LINE_WORDS.some((type) => isCloseTypeWord(word, type))) hits += 1;
  }
  return hits;
}

function isCloseTypeWord(word: string, type: string): boolean {
  if (word === type) return true;
  const maxDist = word.length >= 5 || type.length >= 7 ? 2 : 1;
  if (Math.abs(word.length - type.length) > maxDist) return false;
  return levenshtein(word, type) <= maxDist;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) dp[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0] ?? 0;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min((prev ?? 0) + cost, (dp[j] ?? 0) + 1, (dp[j - 1] ?? 0) + 1);
      prev = tmp;
    }
  }
  return dp[b.length] ?? b.length;
}

function countLetters(text: string): number {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

function countDigits(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

export function mergeLineFragments(regions: OCRRegion[]): OCRRegion[] {
  const sorted = [...regions].sort((a, b) => {
    const yDiff = a.boundingBox.y - b.boundingBox.y;
    if (Math.abs(yDiff) > 10) return yDiff;
    return a.boundingBox.x - b.boundingBox.x;
  });

  const merged: OCRRegion[] = [];
  for (const region of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && shouldMerge(previous, region)) {
      merged[merged.length - 1] = combineRegions(previous, region);
    } else {
      merged.push(region);
    }
  }
  return merged;
}

function shouldMerge(left: OCRRegion, right: OCRRegion): boolean {
  const leftHeight = left.boundingBox.height;
  const rightHeight = right.boundingBox.height;
  const maxHeight = Math.max(leftHeight, rightHeight);
  const minHeight = Math.min(leftHeight, rightHeight);

  // Same-font fragments only. Packed neighboring cards differ in scale and
  // sit a full space-plus apart, so they stay separate.
  if (maxHeight === 0 || minHeight / maxHeight < 0.8) return false;

  const leftMidY = left.boundingBox.y + leftHeight / 2;
  const rightMidY = right.boundingBox.y + rightHeight / 2;
  if (Math.abs(leftMidY - rightMidY) > maxHeight * 0.4) return false;

  const leftRightEdge = left.boundingBox.x + left.boundingBox.width;
  const gap = right.boundingBox.x - leftRightEdge;
  const maxGap = Math.max(8, maxHeight * 0.45);
  return gap >= -maxHeight * 0.5 && gap <= maxGap;
}

function combineRegions(left: OCRRegion, right: OCRRegion): OCRRegion {
  const xs = [
    left.boundingBox.x,
    left.boundingBox.x + left.boundingBox.width,
    right.boundingBox.x,
    right.boundingBox.x + right.boundingBox.width,
  ];
  const ys = [
    left.boundingBox.y,
    left.boundingBox.y + left.boundingBox.height,
    right.boundingBox.y,
    right.boundingBox.y + right.boundingBox.height,
  ];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return {
    text: `${left.text} ${right.text}`.replace(/\s+/g, " ").trim(),
    confidence: Math.min(left.confidence, right.confidence),
    polygon: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
    boundingBox: { x, y, width, height },
  };
}

function isLikelyTitle(region: OCRRegion): boolean {
  return titleFilterReason(region) === null;
}

export function sanitizeOcrText(text: string): string {
  return text
    .trim()
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/^[A-Za-z]\.\s+/, "")
    .replace(/^[^A-Za-z0-9]+/, "")
    .trim();
}

function polygonAngle(region: OCRRegion): number {
  const [a, b] = longestEdge(region.polygon);
  if (!a || !b) return 0;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function longestEdge(polygon: OCRRegion["polygon"]) {
  let bestLength = -1;
  let best: [OCRRegion["polygon"][0], OCRRegion["polygon"][0]] | null = null;
  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > bestLength) {
      bestLength = length;
      best = [start, end];
    }
  }
  return best ?? [];
}
