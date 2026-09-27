import { selectTitleCandidates } from "../vision/titleCandidates.ts";
import type { OCRRegion } from "../models/detection.ts";

export type TitleReocrMode = "auto" | "off" | "minimal" | "full";

export type TitleReocrSettings = {
  enabled: boolean;
  maxAttempts: number;
  allowExpandRetry: boolean;
  enhanceBands: boolean;
  /** Set in debug when re-OCR was skipped or capped. */
  note?: string;
};

const DENSE_RAW_OCR_LINES = 100;
const ENOUGH_TITLE_CANDIDATES = 28;

function readQueryParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

export function readTitleReocrMode(): TitleReocrMode {
  const raw = readQueryParam("reocr")?.trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  if (raw === "minimal" || raw === "lite") return "minimal";
  if (raw === "full" || raw === "max") return "full";
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const fromEnv = env?.VITE_TITLE_REOCR?.trim().toLowerCase();
  if (fromEnv === "off" || fromEnv === "0") return "off";
  if (fromEnv === "minimal") return "minimal";
  if (fromEnv === "full") return "full";
  return "auto";
}

export function isFastScan(): boolean {
  if (readQueryParam("fast") === "1") return true;
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_FAST_SCAN === "1";
}

function deviceMemoryGb(): number | undefined {
  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === "number" && value > 0 ? value : undefined;
}

export function resolveTitleReocrSettings(
  initialRegions: OCRRegion[],
  mode: TitleReocrMode = readTitleReocrMode(),
): TitleReocrSettings {
  if (mode === "off" || isFastScan()) {
    return {
      enabled: false,
      maxAttempts: 0,
      allowExpandRetry: false,
      enhanceBands: false,
      note: mode === "off" || isFastScan() ? "title re-OCR disabled" : undefined,
    };
  }

  const titleCandidates = selectTitleCandidates(initialRegions).length;
  const rawLines = initialRegions.length;

  if (mode === "full") {
    return {
      enabled: true,
      maxAttempts: 36,
      allowExpandRetry: true,
      enhanceBands: true,
    };
  }

  if (mode === "minimal") {
    return {
      enabled: titleCandidates < ENOUGH_TITLE_CANDIDATES,
      maxAttempts: 10,
      allowExpandRetry: false,
      enhanceBands: false,
      note: titleCandidates >= ENOUGH_TITLE_CANDIDATES ? "enough titles from first pass" : "minimal re-OCR",
    };
  }

  // auto — cap work on dense photos and low-RAM devices (common mobile crash).
  const dense = rawLines >= DENSE_RAW_OCR_LINES || titleCandidates >= ENOUGH_TITLE_CANDIDATES;
  const lowMemory = deviceMemoryGb() !== undefined && (deviceMemoryGb() ?? 8) <= 4;

  if (dense || lowMemory) {
    if (titleCandidates >= ENOUGH_TITLE_CANDIDATES) {
      return {
        enabled: false,
        maxAttempts: 0,
        allowExpandRetry: false,
        enhanceBands: false,
        note: "skipped re-OCR (dense photo, first pass enough)",
      };
    }
    return {
      enabled: true,
      maxAttempts: lowMemory ? 8 : 12,
      allowExpandRetry: false,
      enhanceBands: false,
      note: dense ? "capped re-OCR (dense photo)" : "capped re-OCR (low memory)",
    };
  }

  return {
    enabled: true,
    maxAttempts: 24,
    allowExpandRetry: true,
    enhanceBands: true,
  };
}
