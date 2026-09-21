import { loadCardIndex } from "../cards/cardIndex.ts";
import { matchCardName, nameSimilarity, looksLikeTokenGibberishQuery } from "../cards/fuzzyMatch.ts";
import { isBasicLand } from "../models/deck.ts";
import type { CardDetection, DetectionStatus } from "../models/detection.ts";
import { normalizeCardName } from "../cards/normalize.ts";
import { recognizeText, recognizeTitleBand, preloadOcr } from "./ocr.ts";
import { reocrTitleBands } from "./titleBandReocr.ts";
import { annotateBasicLandCounts } from "./landPiles.ts";
import { prepareImage, type PreparedImage } from "./preprocess.ts";
import { expectedNamesForFilename } from "./sampleCatalog.ts";
import { traceExpectedCards, type ScanDebug } from "./scanDebug.ts";
import {
  bodyTextReason,
  looksLikeGarbledTitleNoise,
  sanitizeOcrText,
  selectTitleCandidates,
  titleFilterReason,
} from "./titleCandidates.ts";

export type ScanProgress =
  | "loading-cards"
  | "loading-ocr"
  | "preparing-image"
  | "reading-text"
  | "re-reading-titles"
  | "matching-names"
  | "counting-lands";

export type ScanResult = {
  image: PreparedImage;
  detections: CardDetection[];
  debug: ScanDebug;
};

export async function scanDeckPhoto(
  file: File,
  onProgress: (step: ScanProgress) => void,
): Promise<ScanResult> {
  onProgress("loading-cards");
  const indexPromise = loadCardIndex();
  onProgress("loading-ocr");
  const ocrPromise = preloadOcr();

  onProgress("preparing-image");
  const image = await prepareImage(file);

  await ocrPromise;
  onProgress("reading-text");
  const initialRegions = await recognizeText(image.ocrCanvas);
  onProgress("re-reading-titles");
  const reocr = await reocrTitleBands(
    image.ocrCanvas,
    initialRegions,
    recognizeTitleBand,
  );
  const regions = reocr.regions;
  const filteredOut = regions.flatMap((region) => {
    const why = titleFilterReason(region);
    return why
      ? [{ text: region.text, confidence: region.confidence, why }]
      : [];
  });
  const candidates = selectTitleCandidates(regions);
  const landRowY = image.height * 0.68;

  onProgress("matching-names");
  const index = await indexPromise;
  const matched = candidates.map((region) => {
    const inLandRow =
      region.boundingBox.y + region.boundingBox.height / 2 >= landRowY;
    const result = matchCardName(index, sanitizeOcrText(region.text), region.confidence, {
      preferLands: inLandRow,
    });
    const best = result.best;
    const status = statusForMatch(best?.score ?? 0, Boolean(best));
    return {
      id: crypto.randomUUID(),
      name: status === "unknown" ? undefined : best?.name,
      detectedText: region.text,
      confidence: best?.score ?? region.confidence,
      polygon: region.polygon,
      boundingBox: region.boundingBox,
      matches: result.matches,
      status,
      source: "ocr" as const,
    };
  });
  const { kept, suppressed } = suppressOverlapping(matched, landRowY);
  onProgress("counting-lands");
  const counted = await annotateBasicLandCounts(
    image.ocrCanvas,
    kept,
    regions,
    recognizeText,
  );
  const detections = counted.detections;
  const expectedNames = expectedNamesForFilename(file.name);
  const debug: ScanDebug = {
    rawOcr: regions.map((region) => ({
      text: region.text,
      confidence: region.confidence,
      box: region.boundingBox,
    })),
    filteredOut,
    candidates: candidates.map((region) => ({
      text: region.text,
      confidence: region.confidence,
    })),
    suppressed: suppressed.map((item) => ({
      text: item.detectedText,
      name: item.name,
    })),
    landCounts: counted.debug,
    titleBandReocr: reocr.attempts,
    traces: traceExpectedCards(
      expectedNames,
      regions,
      filteredOut,
      candidates,
      suppressed.map((item) => ({
        detectedText: item.detectedText,
        name: item.name,
      })),
      detections,
    ),
  };

  return { image, detections, debug };
}

export function suppressOverlapping(
  detections: CardDetection[],
  landRowY?: number,
): {
  kept: CardDetection[];
  suppressed: CardDetection[];
} {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const overlapKept: CardDetection[] = [];
  const suppressed: CardDetection[] = [];
  for (const detection of sorted) {
    const overlaps = overlapKept.some(
      (other) => iou(detection.boundingBox, other.boundingBox) > 0.3,
    );
    if (overlaps) suppressed.push(detection);
    else overlapKept.push(detection);
  }

  const afterDuplicates = dropSmallerRereads(overlapKept, suppressed);
  const afterTokens = dropTokenDetections(afterDuplicates, suppressed);
  const afterLandOracle = dropLandOracleRereads(afterTokens, suppressed, landRowY);
  const afterBody = dropColumnBodyText(afterLandOracle, suppressed, landRowY);
  const afterWeak = dropWeakUnknowns(afterBody, suppressed, landRowY);
  return { kept: afterWeak, suppressed };
}

const TOKEN_ONLY_NAMES = new Set([
  "treasure",
  "treasury",
  "food",
  "clue",
  "blood",
  "map",
  "powerstone",
  "junk",
  "gold",
  "shard",
  "lander",
  "bait",
]);

function dropTokenDetections(
  detections: CardDetection[],
  suppressed: CardDetection[],
): CardDetection[] {
  const kept: CardDetection[] = [];
  for (const detection of detections) {
    const name = normalizeCardName(detection.name ?? "");
    const text = normalizeCardName(detection.detectedText);
    if (TOKEN_ONLY_NAMES.has(name) || TOKEN_ONLY_NAMES.has(text)) {
      suppressed.push(detection);
      continue;
    }
    if (looksLikeTokenOcr(detection.detectedText, detection.name)) {
      suppressed.push(detection);
      continue;
    }
    kept.push(detection);
  }
  return kept;
}

function looksLikeTokenOcr(detectedText: string, name?: string): boolean {
  const text = normalizeCardName(detectedText);
  if (!text || text.length < 4) return false;
  const norm = normalizeCardName(name ?? "");
  const first = norm.split(" ")[0] ?? "";
  if (!TOKEN_ONLY_NAMES.has(norm) && !TOKEN_ONLY_NAMES.has(first)) return false;
  if (looksLikeTokenGibberishQuery(detectedText)) return true;
  const similarity = nameSimilarity(text, name ?? detectedText);
  return similarity < 0.72;
}

function dropLandOracleRereads(
  detections: CardDetection[],
  suppressed: CardDetection[],
  landRowY?: number,
): CardDetection[] {
  if (landRowY === undefined) return detections;
  const titleBand = landRowY + 28;
  const kept: CardDetection[] = [];
  for (const detection of detections) {
    if (detection.boundingBox.y <= titleBand) {
      kept.push(detection);
      continue;
    }
    const shadowed = detections.some(
      (other) =>
        other !== detection &&
        other.boundingBox.y <= titleBand &&
        sameResolvedName(other, detection) &&
        horizontalOverlapRatio(detection.boundingBox, other.boundingBox) > 0.35,
    );
    if (shadowed) suppressed.push(detection);
    else kept.push(detection);
  }
  return kept;
}

function dropWeakUnknowns(
  detections: CardDetection[],
  suppressed: CardDetection[],
  landRowY?: number,
): CardDetection[] {
  const kept: CardDetection[] = [];
  for (const detection of detections) {
    const genericLand =
      landRowY !== undefined &&
      detection.boundingBox.y + detection.boundingBox.height / 2 >= landRowY &&
      normalizeDetected(detection.detectedText) === "land";
    if (genericLand) {
      suppressed.push(detection);
      continue;
    }
    if (detection.status !== "unknown") {
      kept.push(detection);
      continue;
    }
    if (bodyTextReason(detection.detectedText)) {
      suppressed.push(detection);
      continue;
    }
    if (looksLikeGarbledTitleNoise(detection.detectedText)) {
      suppressed.push(detection);
      continue;
    }
    if (detection.status !== "confirmed" && detection.confidence < 0.78) {
      const words = detection.detectedText.trim().split(/\s+/).filter(Boolean);
      if (words.length >= 3 && words.some((word) => word.length >= 8 && /[A-Z]/.test(word) && /[a-z]/.test(word))) {
        suppressed.push(detection);
        continue;
      }
    }
    const columnNeighbor = detections.some(
      (other) =>
        other !== detection &&
        horizontalOverlapRatio(detection.boundingBox, other.boundingBox) > 0.28 &&
        Math.abs(other.boundingBox.y - detection.boundingBox.y) < 160,
    );
    if (!columnNeighbor && detection.boundingBox.x < 90) {
      suppressed.push(detection);
      continue;
    }
    if (
      landRowY !== undefined &&
      detection.boundingBox.y >= landRowY + 24 &&
      (detection.confidence < 0.5 || detection.detectedText.length > 24)
    ) {
      suppressed.push(detection);
      continue;
    }
    kept.push(detection);
  }
  return kept;
}

function normalizeDetected(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function dropSmallerRereads(
  detections: CardDetection[],
  suppressed: CardDetection[],
): CardDetection[] {
  const kept: CardDetection[] = [];
  for (const detection of detections) {
    const shadowedByTitle = detections.some(
      (other) =>
        other !== detection &&
        sameResolvedName(other, detection) &&
        horizontalOverlapRatio(detection.boundingBox, other.boundingBox) > 0.5 &&
        other.boundingBox.height > detection.boundingBox.height * 1.5,
    );
    if (shadowedByTitle) suppressed.push(detection);
    else kept.push(detection);
  }
  return kept;
}

function dropColumnBodyText(
  detections: CardDetection[],
  suppressed: CardDetection[],
  landRowY?: number,
): CardDetection[] {
  const landY = landRowY ?? inferLandRowY(detections);
  const kept: CardDetection[] = [];
  for (const detection of detections) {
    if (shouldKeepDetection(detection, detections, landY)) kept.push(detection);
    else suppressed.push(detection);
  }
  return kept;
}

function shouldKeepDetection(
  detection: CardDetection,
  all: CardDetection[],
  landY: number | undefined,
): boolean {
  const box = detection.boundingBox;
  const midY = box.y + box.height / 2;

  if (landY !== undefined && midY >= landY + 110) {
    if (!isBasicLand(detection.name) && !looksLikeLandTitle(detection)) return false;
  }

  if (landY !== undefined && midY >= landY - 18) {
    const landTitle = nearestAboveInColumn(detection, all, landY);
    if (
      landTitle &&
      box.y >= landTitle.boundingBox.y + landTitle.boundingBox.height + 10
    ) {
      return false;
    }
    const above = nearestAboveInColumn(detection, all);
    if (
      above &&
      !isBasicLand(above.name) &&
      isBodyOfCardAbove(detection, above)
    ) {
      return false;
    }
    return true;
  }

  if (bodyTextReason(detection.detectedText)) return false;

  if (isBodyOfAnyTitleAbove(detection, all)) {
    const peers = titleRowPeers(detection, all);
    if (peers.length >= 1 && box.height >= 12) return true;
    return false;
  }

  const above = nearestAboveInColumn(detection, all);
  if (!above) return true;

  const peers = titleRowPeers(detection, all);
  if (peers.length >= 1 && box.height >= 12) return true;

  const anchor = nearestSubstantialAbove(detection, all) ?? above;
  const pitch = box.y - anchor.boundingBox.y;
  if (pitch < 88) return true;
  if (
    detection.name &&
    detection.status !== "unknown" &&
    box.height <= 12 &&
    pitch < 132 &&
    normalizeCardName(detection.detectedText) !== normalizeCardName(detection.name)
  ) {
    return true;
  }
  return false;
}

function nearestSubstantialAbove(
  detection: CardDetection,
  all: CardDetection[],
): CardDetection | undefined {
  const box = detection.boundingBox;
  let best: CardDetection | undefined;
  for (const other of all) {
    if (other === detection) continue;
    if (other.boundingBox.y + other.boundingBox.height > box.y) continue;
    if (horizontalOverlapRatio(box, other.boundingBox) < 0.28) continue;
    if (other.boundingBox.height < 12 && other.confidence < 0.84) continue;
    if (looksLikeGarbledTitleNoise(other.detectedText)) continue;
    if (!best || other.boundingBox.y > best.boundingBox.y) best = other;
  }
  return best;
}

function looksLikeLandTitle(detection: CardDetection): boolean {
  if (isBasicLand(detection.name)) return true;
  const words = detection.detectedText.trim().split(/\s+/).filter(Boolean);
  return words.length <= 2 && detection.boundingBox.height >= 16;
}

function isBodyOfAnyTitleAbove(
  detection: CardDetection,
  all: CardDetection[],
): boolean {
  for (const other of all) {
    if (other === detection) continue;
    if (other.boundingBox.height < 13) continue;
    if (other.boundingBox.y + other.boundingBox.height > detection.boundingBox.y) {
      continue;
    }
    if (horizontalOverlapRatio(detection.boundingBox, other.boundingBox) < 0.28) {
      continue;
    }
    if (isBodyOfCardAbove(detection, other)) return true;
  }
  return false;
}

function isBodyOfCardAbove(detection: CardDetection, above: CardDetection): boolean {
  const box = detection.boundingBox;
  const parent = above.boundingBox;
  const gap = box.y - (parent.y + parent.height);
  const widthRatio = box.width / Math.max(1, parent.width);
  const heightRatio = box.height / Math.max(1, parent.height);
  if (widthRatio > 1.35 && gap >= 36 && gap <= 78 && box.height <= parent.height + 1) {
    return true;
  }
  if (box.height <= 11 && parent.height >= 13 && gap >= 40 && gap <= 72) return true;
  if (gap >= 85 && heightRatio <= 0.85 && widthRatio >= 0.9) return true;
  return false;
}

function titleRowPeers(detection: CardDetection, all: CardDetection[]): CardDetection[] {
  return rowPeers(detection, all).filter((peer) => {
    if (bodyTextReason(peer.detectedText)) return false;
    if (looksLikeGarbledTitleNoise(peer.detectedText)) return false;
    if (peer.detectedText.trim().split(/\s+/).length > 5) return false;
    if (peer.boundingBox.height <= 10 && peer.confidence < 0.82) return false;
    const dx = Math.abs(
      peer.boundingBox.x +
        peer.boundingBox.width / 2 -
        (detection.boundingBox.x + detection.boundingBox.width / 2),
    );
    if (dx <= 40) return false;
    if (isBodyOfAnyTitleAbove(peer, all)) return false;
    return true;
  });
}

function inferLandRowY(detections: CardDetection[]): number | undefined {
  const maxBottom = detections.reduce(
    (max, detection) =>
      Math.max(max, detection.boundingBox.y + detection.boundingBox.height),
    0,
  );
  if (maxBottom < 80) return undefined;
  const maxX = detections.reduce(
    (max, detection) =>
      Math.max(max, detection.boundingBox.x + detection.boundingBox.width),
    0,
  );
  const floor = maxBottom * 0.55;
  const lower = detections
    .filter((detection) => detection.boundingBox.y + detection.boundingBox.height / 2 >= floor)
    .sort((a, b) => a.boundingBox.y - b.boundingBox.y);
  if (lower.length < 2) return undefined;

  const clusters: CardDetection[][] = [];
  for (const detection of lower) {
    const current = clusters[clusters.length - 1];
    const prev = current?.[current.length - 1];
    if (prev && detection.boundingBox.y - prev.boundingBox.y < 40) {
      current.push(detection);
    } else {
      clusters.push([detection]);
    }
  }

  const minSpan = Math.max(180, maxX * 0.35);
  const ranked = clusters.flatMap((cluster) => {
    if (cluster.length < 2) return [];
    const left = Math.min(...cluster.map((item) => item.boundingBox.x));
    const right = Math.max(
      ...cluster.map((item) => item.boundingBox.x + item.boundingBox.width),
    );
    if (right - left < minSpan) return [];
    const heights = cluster.map((item) => item.boundingBox.height).sort((a, b) => a - b);
    const ys = cluster.map((item) => item.boundingBox.y).sort((a, b) => a - b);
    return [
      {
        y: ys[Math.floor(ys.length / 2)] ?? 0,
        height: heights[Math.floor(heights.length / 2)] ?? 0,
      },
    ];
  });
  ranked.sort((a, b) => b.height - a.height || a.y - b.y);
  return ranked[0]?.y;
}

function nearestAboveInColumn(
  detection: CardDetection,
  all: CardDetection[],
  minY?: number,
): CardDetection | undefined {
  let best: CardDetection | undefined;
  for (const other of all) {
    if (other === detection) continue;
    if (minY !== undefined) {
      const otherMid = other.boundingBox.y + other.boundingBox.height / 2;
      if (otherMid < minY - 18) continue;
    }
    if (other.boundingBox.y + other.boundingBox.height > detection.boundingBox.y) {
      continue;
    }
    if (horizontalOverlapRatio(detection.boundingBox, other.boundingBox) < 0.28) {
      continue;
    }
    if (!best || other.boundingBox.y > best.boundingBox.y) best = other;
  }
  return best;
}

function rowPeers(detection: CardDetection, all: CardDetection[]): CardDetection[] {
  const y = detection.boundingBox.y;
  return all.filter((other) => {
    if (other === detection) return false;
    return Math.abs(other.boundingBox.y - y) < 24;
  });
}

function sameResolvedName(a: CardDetection, b: CardDetection): boolean {
  return Boolean(a.name && b.name && a.name === b.name);
}

function horizontalOverlapRatio(
  a: CardDetection["boundingBox"],
  b: CardDetection["boundingBox"],
): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const overlap = right - left;
  if (overlap <= 0) return 0;
  return overlap / Math.max(1, Math.min(a.width, b.width));
}

function iou(
  a: CardDetection["boundingBox"],
  b: CardDetection["boundingBox"],
): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.width, b.x + b.width) - x;
  const h = Math.min(a.y + a.height, b.y + b.height) - y;
  if (w <= 0 || h <= 0) return 0;
  const intersection = w * h;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function statusForMatch(score: number, hasMatch: boolean): DetectionStatus {
  if (!hasMatch || score < 0.58) return "unknown";
  if (score >= 0.82) return "confirmed";
  return "uncertain";
}
