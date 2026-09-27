import { describe, expect, it } from "vitest";
import type { OCRRegion } from "../models/detection.ts";
import { resolveTitleReocrSettings } from "./scanConfig.ts";

function regions(count: number): OCRRegion[] {
  return Array.from({ length: count }, (_, index) => ({
    text: "Archon of Sun's Grace",
    confidence: 0.9,
    polygon: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 16 },
      { x: 0, y: 16 },
    ],
    boundingBox: { x: 10, y: index * 18, width: 120, height: 16 },
  }));
}

describe("resolveTitleReocrSettings", () => {
  it("disables re-OCR when mode is off", () => {
    const settings = resolveTitleReocrSettings(regions(10), "off");
    expect(settings.enabled).toBe(false);
    expect(settings.maxAttempts).toBe(0);
  });

  it("skips re-OCR on dense raw OCR when the first pass already has many title candidates", () => {
    const dense = regions(120);
    const settings = resolveTitleReocrSettings(dense, "auto");
    expect(settings.enabled).toBe(false);
    expect(settings.note).toMatch(/skipped/i);
  });

  it("caps attempts on dense photos that still need titles", () => {
    const noisy = regions(120).map((region) => ({
      ...region,
      text: "deals 3 damage",
    }));
    const settings = resolveTitleReocrSettings(noisy, "auto");
    expect(settings.enabled).toBe(true);
    expect(settings.maxAttempts).toBeLessThanOrEqual(12);
    expect(settings.allowExpandRetry).toBe(false);
  });

  it("uses full budget only in full mode", () => {
    const settings = resolveTitleReocrSettings(regions(20), "full");
    expect(settings.maxAttempts).toBe(36);
    expect(settings.allowExpandRetry).toBe(true);
  });
});
