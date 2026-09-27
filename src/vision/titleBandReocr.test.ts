import { describe, expect, it } from "vitest";
import type { OCRRegion, Rect } from "../models/detection.ts";
import {
  collectPlannedRects,
  mapRegionToCanvas,
  mergeOcrRegions,
  planTitleBandRects,
  prioritizePlannedRects,
} from "./titleBandReocr.ts";

function region(
  text: string,
  box: Rect,
  confidence = 0.8,
): OCRRegion {
  return {
    text,
    confidence,
    polygon: [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ],
    boundingBox: box,
  };
}

describe("planTitleBandRects", () => {
  it("schedules a gap crop between stacked titles in the same column", () => {
    const regions = [
      region("Luminarch Aspirant", { x: 216, y: 4, width: 78, height: 16 }),
      region("Grotag", { x: 221, y: 113, width: 25, height: 10 }),
      region("Flame Channeler", { x: 230, y: 181, width: 61, height: 13 }),
      region("Sunhome Guildmage", { x: 213, y: 305, width: 82, height: 17 }),
      region("Batrkfe Forgs", { x: 137, y: 540, width: 65, height: 19 }),
      region("Swamp", { x: 696, y: 539, width: 37, height: 23 }),
    ];

    const rects = planTitleBandRects({ width: 1024, height: 768 }, regions);
    const gapRects = rects.filter(
      (rect) => rect.x >= 200 && rect.x <= 240 && rect.y > 120 && rect.y < 280,
    );

    expect(gapRects.length).toBeGreaterThan(0);
  });

  it("schedules land-row re-OCR when the column only has a weak fragment", () => {
    const regions = [
      region("Grand Coliseum", { x: 283, y: 536, width: 67, height: 33 }),
      region("la", { x: 696, y: 536, width: 22, height: 9 }, 0.5),
    ];

    const rects = planTitleBandRects({ width: 1024, height: 768 }, regions);
    const swampBand = rects.find(
      (rect) => rect.x >= 660 && rect.x <= 720 && rect.y >= 520,
    );

    expect(swampBand).toBeDefined();
  });

  it("infers missing land-row columns beyond the last detected title", () => {
    const regions = [
      region("Arid Mesa", { x: 14, y: 540, width: 45, height: 15 }),
      region("Sacred Foi", { x: 79, y: 543, width: 42, height: 13 }),
      region("Battlefield Forge", { x: 137, y: 540, width: 65, height: 19 }),
      region("Sulfurous Springs", { x: 216, y: 546, width: 54, height: 14 }),
      region("Grand Coliseum", { x: 282, y: 544, width: 66, height: 10 }),
      region("Ghitu Encampment", { x: 369, y: 547, width: 74, height: 10 }),
      region("Plains", { x: 533, y: 545, width: 26, height: 10 }),
    ];

    const planned = collectPlannedRects({ width: 1024, height: 768 }, regions);
    const rightLand = planned.filter(
      (item) => item.reason === "land-row" && item.rect.x >= 620,
    );

    expect(rightLand.length).toBeGreaterThan(0);
  });

  it("prioritizes the land-row strip before column-gap crops", () => {
    const regions = [
      region("Luminarch Aspirant", { x: 216, y: 4, width: 78, height: 16 }),
      region("Flame Channeler", { x: 230, y: 181, width: 61, height: 13 }),
      region("Sunhome Guildmage", { x: 213, y: 305, width: 82, height: 17 }),
      region("Arid Mesa", { x: 14, y: 540, width: 45, height: 15 }),
      region("Sacred Foi", { x: 79, y: 543, width: 42, height: 13 }),
      region("Plains", { x: 533, y: 545, width: 26, height: 10 }),
      region("Grand Coliseum", { x: 282, y: 544, width: 66, height: 10 }),
    ];
    const planned = prioritizePlannedRects(
      collectPlannedRects({ width: 1024, height: 768 }, regions),
    );

    expect(planned[0]?.reason).toBe("land-row-strip");
    const firstGap = planned.find((item) => item.reason === "column-gap");
    const firstLand = planned.find((item) => item.reason === "land-row");
    expect(firstLand).toBeDefined();
    expect((firstLand?.priority ?? 999) < (firstGap?.priority ?? 999)).toBe(true);
  });

  it("skips the land-row strip when landmarks already cover that row", () => {
    const regions = [
      region("Luminarch Aspirant", { x: 216, y: 4, width: 78, height: 16 }),
      region("Arid Mesa", { x: 14, y: 540, width: 45, height: 15 }),
    ];
    const landmarks = [
      { x: 14, y: 540, width: 48, height: 18 },
      { x: 80, y: 542, width: 42, height: 16 },
      { x: 140, y: 541, width: 60, height: 18 },
      { x: 220, y: 544, width: 54, height: 16 },
      { x: 300, y: 543, width: 50, height: 17 },
    ];
    const planned = collectPlannedRects(
      { width: 1024, height: 768 },
      regions,
      landmarks,
    );
    expect(planned.some((item) => item.reason === "land-row-strip")).toBe(false);
  });

  it("plans stacked gaps from landmark bands even without OCR titles", () => {
    const landmarks = [
      { x: 216, y: 4, width: 78, height: 16 },
      { x: 218, y: 70, width: 80, height: 16 },
      { x: 213, y: 220, width: 82, height: 17 },
    ];
    const planned = collectPlannedRects({ width: 1024, height: 768 }, [], landmarks);
    const gaps = planned.filter(
      (item) =>
        item.reason === "column-gap" &&
        item.rect.x >= 180 &&
        item.rect.x <= 250 &&
        item.rect.y > 80 &&
        item.rect.y < 210,
    );
    expect(gaps.length).toBeGreaterThan(0);
  });

  it("fills missing stacked title bands above and below a single column anchor", () => {
    const regions = [
      region("Inti, Seneschal of the Sun", { x: 325, y: 69, width: 69, height: 15 }),
      region("Laelia, the Blade Reforged", { x: 612, y: 41, width: 41, height: 13 }),
      region("Plains", { x: 470, y: 545, width: 50, height: 20 }),
    ];

    const planned = collectPlannedRects({ width: 1024, height: 768 }, regions);
    const aboveInti = planned.filter(
      (item) =>
        item.reason === "column-gap" &&
        item.rect.x >= 300 &&
        item.rect.x <= 360 &&
        item.rect.y < 60,
    );
    const belowLaelia = planned.filter(
      (item) =>
        item.reason === "column-gap" &&
        item.rect.x >= 590 &&
        item.rect.x <= 650 &&
        item.rect.y > 60 &&
        item.rect.y < 240,
    );
    const mountainBand = planned.filter(
      (item) => item.reason === "land-row" && item.rect.x >= 580,
    );

    expect(aboveInti.length).toBeGreaterThan(0);
    expect(belowLaelia.length).toBeGreaterThan(0);
    expect(mountainBand.length).toBeGreaterThan(0);
  });
});

describe("mergeOcrRegions", () => {
  it("prefers a stronger title read over a weaker overlap", () => {
    const base = [region("Land", { x: 690, y: 620, width: 28, height: 10 }, 0.55)];
    const added = [region("Swamp", { x: 696, y: 539, width: 37, height: 23 }, 0.82)];

    const merged = mergeOcrRegions(base, added);
    expect(merged.some((item) => item.text === "Swamp")).toBe(true);
  });
});

describe("mapRegionToCanvas", () => {
  it("maps crop coordinates back to the source image", () => {
    const mapped = mapRegionToCanvas(
      region("Terminate", { x: 10, y: 8, width: 44, height: 14 }),
      { x: 360, y: 280, width: 80, height: 24 },
      2,
    );

    expect(mapped.boundingBox.x).toBeCloseTo(365, 0);
    expect(mapped.boundingBox.y).toBeCloseTo(284, 0);
    expect(mapped.text).toBe("Terminate");
  });
});
