import { normalizeCardName } from "../cards/normalize.ts";
import type { OCRRegion, Rect } from "../models/detection.ts";
import type { LandCountDebug } from "./landPiles.ts";
import type { TitleBandReocrAttempt } from "./titleBandReocr.ts";

export type MissReason =
  | "matched"
  | "ocr-wrong-match"
  | "ocr-unmatched"
  | "filtered"
  | "suppressed"
  | "not-detected";

export type CardTrace = {
  expected: string;
  reason: MissReason;
  ocrText?: string;
};

export type ScanDebug = {
  rawOcr: { text: string; confidence: number; box: Rect }[];
  filteredOut: { text: string; confidence: number; why: string }[];
  candidates: { text: string; confidence: number }[];
  suppressed: { text: string; name?: string }[];
  landCounts: LandCountDebug[];
  titleBandReocr: TitleBandReocrAttempt[];
  titleReocrNote?: string;
  traces: CardTrace[];
};

export function traceExpectedCards(
  expectedNames: string[],
  rawOcr: OCRRegion[],
  filteredOut: ScanDebug["filteredOut"],
  candidates: OCRRegion[],
  suppressed: { detectedText: string; name?: string }[],
  keptNames: { detectedText: string; name?: string }[],
): CardTrace[] {
  return expectedNames.map((expected) => {
    const expectedNorm = normalizeCardName(expected);
    const kept = keptNames.find(
      (item) =>
        normalizeCardName(item.name ?? "") === expectedNorm ||
        normalizeCardName(item.detectedText) === expectedNorm,
    );
    if (kept?.name && normalizeCardName(kept.name) === expectedNorm) {
      return { expected, reason: "matched", ocrText: kept.detectedText };
    }
    if (kept) {
      return { expected, reason: "ocr-wrong-match", ocrText: kept.detectedText };
    }

    const dropped = suppressed.find(
      (item) =>
        normalizeCardName(item.name ?? "") === expectedNorm ||
        normalizeCardName(item.detectedText) === expectedNorm ||
        normalizeCardName(item.detectedText).includes(expectedNorm) ||
        expectedNorm.includes(normalizeCardName(item.detectedText)),
    );
    if (dropped) {
      return { expected, reason: "suppressed", ocrText: dropped.detectedText };
    }

    const candidate = candidates.find(
      (item) =>
        normalizeCardName(item.text) === expectedNorm ||
        normalizeCardName(item.text).includes(expectedNorm) ||
        expectedNorm.includes(normalizeCardName(item.text)),
    );
    if (candidate) {
      return { expected, reason: "ocr-unmatched", ocrText: candidate.text };
    }

    const filtered = filteredOut.find(
      (item) =>
        normalizeCardName(item.text) === expectedNorm ||
        expectedNorm.includes(normalizeCardName(item.text)),
    );
    if (filtered) {
      return { expected, reason: "filtered", ocrText: filtered.text };
    }

    const raw = rawOcr.find(
      (item) =>
        normalizeCardName(item.text) === expectedNorm ||
        expectedNorm.includes(normalizeCardName(item.text)) ||
        normalizeCardName(item.text).includes(expectedNorm.split(" ")[0] ?? ""),
    );
    if (raw) {
      return { expected, reason: "ocr-unmatched", ocrText: raw.text };
    }

    return { expected, reason: "not-detected" };
  });
}
