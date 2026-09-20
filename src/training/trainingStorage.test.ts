import { describe, expect, it } from "vitest";
import type { CardDetection } from "../models/detection.ts";
import {
  applyPersistedLabels,
  boxIoU,
  buildPersistedLabels,
  hasMeaningfulLabels,
} from "./trainingStorage.ts";

function detection(
  id: string,
  box: { x: number; y: number; width: number; height: number },
  detectedText = "Foo",
  name?: string,
): CardDetection {
  return {
    id,
    detectedText,
    name,
    confidence: 0.9,
    polygon: [],
    boundingBox: box,
    matches: [],
    status: "confirmed",
    source: "ocr",
  };
}

describe("trainingStorage", () => {
  it("computes box overlap", () => {
    expect(boxIoU({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBeCloseTo(
      25 / 175,
    );
    expect(boxIoU({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 })).toBe(0);
  });

  it("round-trips labels through build and apply", () => {
    const detections = [
      detection("a", { x: 10, y: 20, width: 100, height: 24 }, "Bolt", "Lightning Bolt"),
      detection("b", { x: 5, y: 6, width: 200, height: 30 }, "Noise"),
    ];

    const persisted = buildPersistedLabels("sample.jpg", 1024, 768, detections, {
      a: { verdict: "correct", note: "easy read" },
      b: { verdict: "not-card" },
    }, [
      {
        id: "added-1",
        box: { x: 50, y: 60, width: 120, height: 28 },
        text: "Swamp",
        note: "bottom row",
      },
    ]);

    expect(persisted.detections).toHaveLength(2);
    expect(persisted.added).toHaveLength(1);
    expect(hasMeaningfulLabels(persisted)).toBe(true);

    const shifted = [
      detection("new-a", { x: 11, y: 21, width: 98, height: 23 }, "Bolt", "Lightning Bolt"),
      detection("new-b", { x: 6, y: 7, width: 198, height: 29 }, "Noise"),
    ];

    const applied = applyPersistedLabels(shifted, 1024, 768, persisted);
    expect(applied.restoredCount).toBe(3);
    expect(applied.annotations["new-a"]).toEqual({ verdict: "correct", note: "easy read" });
    expect(applied.annotations["new-b"]).toEqual({ verdict: "not-card" });
    expect(applied.added).toHaveLength(1);
    expect(applied.added[0]?.text).toBe("Swamp");
    expect(applied.added[0]?.note).toBe("bottom row");
  });

  it("persists unreviewed detections when they only have a note", () => {
    const detections = [detection("a", { x: 10, y: 20, width: 100, height: 24 })];

    const persisted = buildPersistedLabels("sample.jpg", 1024, 768, detections, {
      a: { verdict: "unreviewed", note: "needs another look" },
    }, []);

    expect(persisted.detections).toHaveLength(1);
    expect(persisted.detections[0]?.note).toBe("needs another look");

    const applied = applyPersistedLabels(detections, 1024, 768, persisted);
    expect(applied.annotations.a).toEqual({
      verdict: "unreviewed",
      note: "needs another look",
    });
  });

  it("skips saved labels that no longer overlap any detection", () => {
    const persisted = buildPersistedLabels(
      "sample.jpg",
      100,
      100,
      [detection("a", { x: 0, y: 0, width: 20, height: 20 })],
      { a: { verdict: "correct" } },
      [],
    );

    const applied = applyPersistedLabels(
      [detection("b", { x: 80, y: 80, width: 20, height: 20 })],
      100,
      100,
      persisted,
    );

    expect(applied.restoredCount).toBe(0);
    expect(applied.annotations).toEqual({});
  });
});
