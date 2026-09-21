import { describe, expect, it } from "vitest";
import {
  clipToPixelRect,
  countFanFromProfile,
  countPips,
  parseDieValue,
  pickBestDieFace,
  verticalEdgeProfile,
} from "./landPiles.ts";
import { buildDecklist, isBasicLand } from "../models/deck.ts";
import type { CardDetection } from "../models/detection.ts";

describe("parseDieValue", () => {
  it("accepts a single die face", () => {
    expect(parseDieValue("8")).toBe(8);
    expect(parseDieValue("15")).toBe(15);
  });

  it("rejects collector-style and non-numeric text", () => {
    expect(parseDieValue("269")).toBeUndefined();
    expect(parseDieValue("4/4")).toBeUndefined();
    expect(parseDieValue("Mountain")).toBeUndefined();
  });

  it("recovers digits from glare-induced letter look-alikes", () => {
    expect(parseDieValue("S")).toBe(5);
    expect(parseDieValue("B")).toBe(8);
    expect(parseDieValue("l2")).toBe(12);
    expect(parseDieValue("G")).toBe(6);
    // A word full of look-alikes must still not read as a die face.
    expect(parseDieValue("Bog")).toBeUndefined();
  });
});

describe("pickBestDieFace", () => {
  it("prefers the largest, most face-on number", () => {
    expect(
      pickBestDieFace([
        { value: 7, area: 40, confidence: 0.99 },
        { value: 15, area: 220, confidence: 0.9 },
        { value: 9, area: 55, confidence: 0.95 },
      ]),
    ).toBe(15);
  });

  it("prefers a centered two-digit face over a side number", () => {
    expect(
      pickBestDieFace(
        [
          { value: 7, area: 90, confidence: 0.96, x: 80, y: 40, width: 14, height: 16 },
          { value: 12, area: 120, confidence: 0.82, x: 36, y: 28, width: 22, height: 18 },
        ],
        { x: 42, y: 32 },
      ),
    ).toBe(12);
  });

  it("joins adjacent digits from a d12 face", () => {
    expect(
      pickBestDieFace(
        [
          { value: 1, area: 40, confidence: 0.9, x: 30, y: 24, width: 10, height: 16 },
          { value: 2, area: 42, confidence: 0.88, x: 42, y: 25, width: 11, height: 16 },
          { value: 7, area: 50, confidence: 0.94, x: 70, y: 48, width: 12, height: 14 },
        ],
        { x: 40, y: 28 },
      ),
    ).toBe(12);
  });
});

describe("clipToPixelRect", () => {
  it("keeps rounded crops inside the canvas so getImageData cannot overflow", () => {
    const clipped = clipToPixelRect({ x: 0.5, y: 0.5, width: 767.5, height: 1023.5 }, 768, 1024);
    expect(clipped.x + clipped.width).toBeLessThanOrEqual(768);
    expect(clipped.y + clipped.height).toBeLessThanOrEqual(1024);
    expect(clipped.width).toBeGreaterThan(0);
    expect(clipped.height).toBeGreaterThan(0);
  });
});

describe("countFanFromProfile", () => {
  it("counts regularly spaced sliver edges", () => {
    const profile = new Array(200).fill(4);
    for (const x of [20, 40, 60, 80, 100, 120]) {
      profile[x] = 40;
      profile[x + 1] = 28;
    }
    expect(countFanFromProfile(profile, 8)).toBe(6);
  });

  it("stays at one card when only the named card borders are present", () => {
    const profile = new Array(120).fill(3);
    profile[18] = 30;
    profile[96] = 30;
    expect(countFanFromProfile(profile, 8)).toBe(1);
  });
});

describe("verticalEdgeProfile", () => {
  it("spikes where neighboring columns change", () => {
    const width = 6;
    const height = 4;
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      gray[y * width + 2] = 200;
    }
    const profile = verticalEdgeProfile(gray, width, height);
    expect(profile[2]).toBeGreaterThan(profile[1] ?? 0);
  });
});

describe("countPips", () => {
  it("counts compact dark blobs on a die face", () => {
    const width = 20;
    const height = 20;
    const binary = new Uint8Array(width * height);
    paintBlob(binary, width, 3, 3, 2);
    paintBlob(binary, width, 14, 3, 2);
    paintBlob(binary, width, 3, 14, 2);
    paintBlob(binary, width, 14, 14, 2);
    expect(countPips(binary, width, height)).toBe(4);
  });
});

describe("buildDecklist land counts", () => {
  it("uses a dice count instead of one card", () => {
    const deck = buildDecklist([
      detection("Mountain", 8, "dice"),
      detection("Lightning Bolt"),
    ]);
    expect(deck.lines).toEqual([
      { name: "Lightning Bolt", count: 1 },
      { name: "Mountain", count: 8 },
    ]);
    expect(deck.total).toBe(9);
  });

  it("skips sibling cards already folded into a pile", () => {
    const deck = buildDecklist([
      detection("Island", 6, "fan"),
      { ...detection("Island"), count: 0 },
    ]);
    expect(deck.lines).toEqual([{ name: "Island", count: 6 }]);
  });

  it("recognizes snow basics", () => {
    expect(isBasicLand("Snow-Covered Island")).toBe(true);
    expect(isBasicLand("Steam Vents")).toBe(false);
  });
});

function detection(
  name: string,
  count?: number,
  countSource?: CardDetection["countSource"],
): CardDetection {
  return {
    id: name,
    name,
    detectedText: name,
    confidence: 1,
    polygon: [],
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    matches: [{ name, score: 1 }],
    status: "confirmed",
    source: "ocr",
    count,
    countSource,
  };
}

function paintBlob(
  binary: Uint8Array,
  width: number,
  cx: number,
  cy: number,
  radius: number,
): void {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      binary[y * width + x] = 1;
    }
  }
}
