import { describe, expect, it } from "vitest";
import {
  detectTitleLandmarksFromRgba,
  keepOcrInTitleLandmarks,
  regionInArtFrame,
  regionInTitleBand,
  shouldMaskOcrToLandmarks,
  type TitleLandmark,
} from "./titleLandmarks.ts";
import type { OCRRegion, Rect } from "../models/detection.ts";

function createRgba(width: number, height: number, fill: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  fillRect(data, width, height, { x: 0, y: 0, width, height }, fill);
  return data;
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rect: Rect,
  color: [number, number, number],
): void {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(width, Math.round(rect.x + rect.width));
  const y1 = Math.min(height, Math.round(rect.y + rect.height));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const o = (y * width + x) * 4;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = 255;
    }
  }
}

function paintArt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rect: Rect,
  seed: number,
): void {
  fillRect(data, width, height, rect, [28, 24, 22]);
  const inner = {
    x: rect.x + 3,
    y: rect.y + 3,
    width: rect.width - 6,
    height: rect.height - 6,
  };
  const x0 = Math.max(0, Math.round(inner.x));
  const y0 = Math.max(0, Math.round(inner.y));
  const x1 = Math.min(width, Math.round(inner.x + inner.width));
  const y1 = Math.min(height, Math.round(inner.y + inner.height));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const n = hash(x + seed * 3, y + seed * 11);
      const o = (y * width + x) * 4;
      data[o] = 40 + (n % 140);
      data[o + 1] = 30 + ((n * 7) % 120);
      data[o + 2] = 50 + ((n * 13) % 160);
      data[o + 3] = 255;
    }
  }
}

function hash(x: number, y: number): number {
  let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 17, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n >>> 0) % 256;
}

function paintModernCard(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  card: { x: number; y: number; w: number; h: number; seed: number },
): { title: Rect; artTop: number } {
  fillRect(data, width, height, { x: card.x, y: card.y, width: card.w, height: card.h }, [
    18, 14, 12,
  ]);
  const inset = 6;
  const titleH = Math.round(card.w * 0.16);
  const title = {
    x: card.x + inset,
    y: card.y + inset,
    width: card.w - inset * 2,
    height: titleH,
  };
  fillRect(data, width, height, title, [214, 188, 96]);
  const art = {
    x: title.x,
    y: title.y + title.height,
    width: title.width,
    height: Math.round(card.w * 0.42),
  };
  paintArt(data, width, height, art, card.seed);
  return { title, artTop: art.y };
}

function region(text: string, box: Rect): OCRRegion {
  return {
    text,
    confidence: 0.8,
    polygon: [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ],
    boundingBox: box,
  };
}

function covering(landmarks: TitleLandmark[], expected: Rect): TitleLandmark | undefined {
  return landmarks.find((item) => {
    const midY = expected.y + expected.height / 2;
    return (
      horizontalOverlap(item.rect, expected) > 0.45 &&
      midY >= item.rect.y - 4 &&
      midY <= item.rect.y + item.rect.height + 4
    );
  });
}

function horizontalOverlap(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const overlap = right - left;
  if (overlap <= 0) return 0;
  return overlap / Math.max(1, Math.min(a.width, b.width));
}

describe("detectTitleLandmarksFromRgba", () => {
  it("finds title bands between card tops and art frames in a stacked layout", () => {
    const width = 420;
    const height = 460;
    const data = createRgba(width, height, [24, 90, 70]);
    const cards = [
      { x: 28, y: 24, w: 150, h: 220, seed: 3 },
      { x: 28, y: 118, w: 150, h: 220, seed: 9 },
      { x: 28, y: 212, w: 150, h: 220, seed: 14 },
      { x: 230, y: 36, w: 150, h: 220, seed: 21 },
      { x: 230, y: 128, w: 150, h: 220, seed: 27 },
      { x: 230, y: 224, w: 150, h: 220, seed: 33 },
    ];
    const titles = cards.map((card) => paintModernCard(data, width, height, card).title);

    const landmarks = detectTitleLandmarksFromRgba(data, width, height);
    expect(landmarks.length).toBeGreaterThanOrEqual(4);
    const missed = titles.filter((title) => !covering(landmarks, title));
    expect(missed).toEqual([]);
  });

  it("does not treat the type line or rules box as a title", () => {
    const width = 280;
    const height = 360;
    const data = createRgba(width, height, [30, 86, 64]);
    const card = { x: 40, y: 20, w: 180, h: 300, seed: 4 };
    const { title, artTop } = paintModernCard(data, width, height, card);
    const typeLine = {
      x: title.x,
      y: artTop + Math.round(card.w * 0.42),
      width: title.width,
      height: 18,
    };
    fillRect(data, width, height, typeLine, [232, 220, 190]);
    const textBox = {
      x: typeLine.x,
      y: typeLine.y + typeLine.height,
      width: typeLine.width,
      height: 70,
    };
    fillRect(data, width, height, textBox, [226, 214, 186]);

    const landmarks = detectTitleLandmarksFromRgba(data, width, height);
    expect(covering(landmarks, title)).toBeDefined();
    const falsePositives = landmarks.filter(
      (item) => item.rect.y >= typeLine.y - 4,
    );
    expect(falsePositives).toEqual([]);
  });

  it("finds a packed land row of side-by-side title bars", () => {
    const width = 520;
    const height = 220;
    const data = createRgba(width, height, [28, 72, 58]);
    const titles: Rect[] = [];
    for (let i = 0; i < 4; i += 1) {
      const painted = paintModernCard(data, width, height, {
        x: 16 + i * 124,
        y: 36,
        w: 112,
        h: 160,
        seed: 40 + i,
      });
      titles.push(painted.title);
    }

    const landmarks = detectTitleLandmarksFromRgba(data, width, height);
    const hits = titles.filter((title) => covering(landmarks, title));
    expect(hits.length).toBe(4);
  });

  it("returns no landmarks on a noisy playmat", () => {
    const width = 240;
    const height = 180;
    const data = createRgba(width, height, [26, 88, 68]);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (hash(x, y) > 240) {
          const o = (y * width + x) * 4;
          data[o] = 40;
          data[o + 1] = 110;
          data[o + 2] = 80;
        }
      }
    }
    expect(detectTitleLandmarksFromRgba(data, width, height)).toEqual([]);
  });
});

describe("title landmark OCR filters", () => {
  const landmarks: TitleLandmark[] = [
    {
      rect: { x: 40, y: 20, width: 120, height: 22 },
      cardTop: 20,
      artTop: 42,
      artFrame: { x: 40, y: 42, width: 120, height: 50 },
      score: 0.8,
    },
  ];

  it("keeps OCR that sits in the title band and drops art-window text", () => {
    expect(regionInTitleBand({ x: 48, y: 24, width: 80, height: 14 }, landmarks)).toBe(
      true,
    );
    expect(regionInArtFrame({ x: 60, y: 70, width: 40, height: 12 }, landmarks)).toBe(
      true,
    );
    const kept = keepOcrInTitleLandmarks(
      [
        region("Sunhome Guildmage", { x: 48, y: 24, width: 80, height: 14 }),
        region("2/2", { x: 60, y: 70, width: 24, height: 12 }),
      ],
      landmarks,
    );
    expect(kept.map((item) => item.text)).toEqual(["Sunhome Guildmage"]);
  });

  it("masks OCR once several title bands are found", () => {
    expect(shouldMaskOcrToLandmarks(landmarks)).toBe(false);
    expect(shouldMaskOcrToLandmarks([...landmarks, ...landmarks, ...landmarks])).toBe(
      true,
    );
  });
});
