import { isBasicLand } from "../models/deck.ts";
import type { CardDetection, OCRRegion, Rect } from "../models/detection.ts";

export type LandCountSource = "dice" | "fan" | "ocr" | "manual";

export type LandCountDebug = {
  name: string;
  count: number;
  source: LandCountSource;
  note?: string;
};

const MIN_DIE = 1;
const MAX_DIE = 24;
const CARD_ASPECT = 88 / 63;

export function estimateCardBody(title: Rect): Rect {
  const height = Math.max(title.height / 0.055, title.width * 1.8, 80);
  const width = Math.max(title.width / 0.55, height / CARD_ASPECT);
  return {
    x: title.x - width * 0.12,
    y: title.y - height * 0.03,
    width,
    height,
  };
}

// Die pips OCR as short numeric strings, but glare and low resolution make the
// engine swap a handful of digits for look-alike letters. Only strings that are
// otherwise pure digits (optionally with trailing punctuation) are treated as a
// die face, so ordinary words can never masquerade as a count.
const DIGIT_LOOKALIKES: Record<string, string> = {
  o: "0",
  O: "0",
  l: "1",
  I: "1",
  i: "1",
  "|": "1",
  Z: "2",
  z: "2",
  S: "5",
  s: "5",
  G: "6",
  b: "6",
  B: "8",
};

export function parseDieValue(text: string): number | undefined {
  const trimmed = text
    .trim()
    .replace(/[oOlIi|ZzSsGbB]/g, (char) => DIGIT_LOOKALIKES[char] ?? char);
  const match = trimmed.match(/^(\d{1,2})[.,:;]?$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (value < MIN_DIE || value > MAX_DIE) return undefined;
  return value;
}

export type DieFace = {
  value: number;
  area: number;
  confidence: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export function combineAdjacentDieDigits(faces: DieFace[]): DieFace[] {
  if (faces.length < 2) return faces;
  const singles = faces.filter((face) => face.value <= 9 && face.x !== undefined);
  const rest = faces.filter((face) => face.value > 9 || face.x === undefined);
  if (singles.length < 2) return faces;

  const used = new Set<number>();
  const combined: DieFace[] = [];
  const sorted = [...singles].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  for (let i = 0; i < sorted.length; i += 1) {
    if (used.has(i)) continue;
    const left = sorted[i];
    if (!left) continue;
    const right = sorted[i + 1];
    if (right && !used.has(i + 1) && digitsAreAdjacent(left, right)) {
      const merged = 10 * left.value + right.value;
      if (merged >= MIN_DIE && merged <= MAX_DIE) {
        used.add(i);
        used.add(i + 1);
        combined.push({
          value: merged,
          area: left.area + right.area,
          confidence: Math.min(left.confidence, right.confidence),
          x: left.x,
          y: Math.min(left.y ?? 0, right.y ?? 0),
          width: (right.x ?? 0) + (right.width ?? 0) - (left.x ?? 0),
          height: Math.max(left.height ?? 0, right.height ?? 0),
        });
        continue;
      }
    }
    combined.push(left);
  }
  return [...rest, ...combined];
}

function digitsAreAdjacent(left: DieFace, right: DieFace): boolean {
  const leftRight = (left.x ?? 0) + (left.width ?? 8);
  const gap = (right.x ?? 0) - leftRight;
  const maxGap = Math.max(10, (left.width ?? 8) * 1.2);
  const yDiff = Math.abs((left.y ?? 0) - (right.y ?? 0));
  return gap >= -4 && gap <= maxGap && yDiff <= Math.max(8, (left.height ?? 10) * 0.7);
}

export function pickBestDieFace(faces: DieFace[], center?: { x: number; y: number }): number | undefined {
  const ranked = combineAdjacentDieDigits(faces);
  if (ranked.length === 0) return undefined;
  const scored = [...ranked].sort((a, b) => {
    const centerBias = dieCenterScore(b, center) - dieCenterScore(a, center);
    if (Math.abs(centerBias) > 0.12) return centerBias;
    const digitBias = (b.value >= 10 ? 1 : 0) - (a.value >= 10 ? 1 : 0);
    if (digitBias !== 0 && Math.abs(a.area - b.area) < Math.max(a.area, b.area) * 0.4) {
      return digitBias;
    }
    const areaDiff = b.area - a.area;
    if (Math.abs(areaDiff) > Math.max(a.area, b.area) * 0.15) return areaDiff;
    return b.confidence - a.confidence;
  });
  return scored[0]?.value;
}

function dieCenterScore(face: DieFace, center?: { x: number; y: number }): number {
  if (!center || face.x === undefined || face.y === undefined) return 0.5;
  const fx = face.x + (face.width ?? 0) / 2;
  const fy = face.y + (face.height ?? 0) / 2;
  const dist = Math.hypot(fx - center.x, fy - center.y);
  return 1 / (1 + dist / 40);
}

export function countFanFromProfile(
  profile: number[],
  minSpacing: number,
): number {
  if (profile.length < 8) return 1;
  const smoothed = smooth(profile, 3);
  const baseline = percentile(smoothed, 0.55);
  const peakFloor = Math.max(baseline * 1.8, maxValue(smoothed) * 0.22);
  const peaks: number[] = [];
  for (let i = 2; i < smoothed.length - 2; i += 1) {
    if (smoothed[i] < peakFloor) continue;
    if (smoothed[i] >= smoothed[i - 1] && smoothed[i] >= smoothed[i + 1]) {
      const previous = peaks[peaks.length - 1];
      if (previous !== undefined && i - previous < minSpacing) {
        if (smoothed[i] > smoothed[previous]) peaks[peaks.length - 1] = i;
        continue;
      }
      peaks.push(i);
    }
  }
  if (peaks.length <= 2) return 1;
  // One named card has two borders; extra regularly spaced edges are extra cards.
  const spacings: number[] = [];
  for (let i = 1; i < peaks.length; i += 1) {
    spacings.push((peaks[i] ?? 0) - (peaks[i - 1] ?? 0));
  }
  const medianGap = median(spacings);
  if (medianGap < minSpacing) {
    return Math.max(1, Math.round(peaks.length / 2));
  }
  const consistent = spacings.filter(
    (gap) => gap > medianGap * 0.55 && gap < medianGap * 1.7,
  ).length;
  if (consistent < 2) return 1;
  const first = peaks[0] ?? 0;
  const last = peaks[peaks.length - 1] ?? first;
  return Math.max(1, Math.round((last - first) / medianGap) + 1);
}

export function verticalEdgeProfile(
  gray: Float32Array,
  width: number,
  height: number,
): number[] {
  const profile = new Array<number>(width).fill(0);
  for (let x = 1; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y < height; y += 1) {
      sum += Math.abs(gray[y * width + x] - gray[y * width + x - 1]);
    }
    profile[x] = height === 0 ? 0 : sum / height;
  }
  return profile;
}

export function countPips(binary: Uint8Array, width: number, height: number): number {
  const seen = new Uint8Array(binary.length);
  let pips = 0;
  for (let i = 0; i < binary.length; i += 1) {
    if (!binary[i] || seen[i]) continue;
    const blob = flood(binary, seen, width, height, i);
    if (!blob) continue;
    const area = blob.w * blob.h;
    if (area < 9 || area > width * height * 0.2) continue;
    const ratio = blob.w / Math.max(1, blob.h);
    if (ratio < 0.55 || ratio > 1.8) continue;
    const fill = blob.filled / Math.max(1, area);
    if (fill < 0.28) continue;
    pips += 1;
  }
  return pips;
}

export async function annotateBasicLandCounts(
  canvas: HTMLCanvasElement,
  detections: CardDetection[],
  rawOcr: OCRRegion[],
  readText: (input: HTMLCanvasElement) => Promise<OCRRegion[]>,
): Promise<{ detections: CardDetection[]; debug: LandCountDebug[] }> {
  const basics = detections.filter(
    (detection) => detection.name && isBasicLand(detection.name),
  );
  if (basics.length === 0) {
    return { detections, debug: [] };
  }

  const counted = await Promise.all(
    basics.map((detection) =>
      countOneLand(canvas, detection, detections, rawOcr, readText),
    ),
  );
  const consumed = new Set<string>();
  const winners = [...counted].sort((a, b) => rankCount(b) - rankCount(a));
  const chosen = new Map<string, (typeof counted)[number]>();
  for (const item of winners) {
    if (consumed.has(item.detection.id)) continue;
    chosen.set(item.detection.id, item);
    consumed.add(item.detection.id);
    for (const sibling of item.siblings) consumed.add(sibling);
  }

  const debug: LandCountDebug[] = [];
  const next = detections.map((detection) => {
    const winner = chosen.get(detection.id);
    if (winner) {
      debug.push({
        name: detection.name ?? detection.detectedText,
        count: winner.count,
        source: winner.source,
        note: winner.note,
      });
      return {
        ...detection,
        count: winner.count,
        countSource: winner.source,
      };
    }
    if (consumed.has(detection.id) && isBasicLand(detection.name)) {
      return { ...detection, count: 0 };
    }
    return detection;
  });
  return { detections: next, debug };
}

function rankCount(item: {
  count: number;
  source: LandCountSource;
  detection: CardDetection;
}): number {
  const sourceRank =
    item.source === "dice" ? 400 : item.source === "fan" ? 300 : 100;
  return sourceRank + item.count * 2 + item.detection.confidence;
}

async function countOneLand(
  canvas: HTMLCanvasElement,
  detection: CardDetection,
  all: CardDetection[],
  rawOcr: OCRRegion[],
  readText: (input: HTMLCanvasElement) => Promise<OCRRegion[]>,
): Promise<{
  detection: CardDetection;
  count: number;
  source: LandCountSource;
  note?: string;
  siblings: string[];
}> {
  const body = clipRect(estimateCardBody(detection.boundingBox), canvas);
  const siblings = nearbySameLands(detection, all, body).map((item) => item.id);
  const art = clipRect(artRect(body, detection.boundingBox), canvas);
  const rawFaces = dieFacesInRect(rawOcr, body, detection.boundingBox);
  let die = pickBestDieFace(rawFaces, {
    x: art.x + art.width / 2,
    y: art.y + art.height / 2,
  });
  let note = die !== undefined ? `raw OCR ${die}` : undefined;

  if (die === undefined) {
    const dieCrops = dieCropsInRect(canvas, art);
    for (const crop of dieCrops) {
      die = await readDieCrop(crop, readText);
      if (die !== undefined) {
        note = `die crop OCR ${die}`;
        break;
      }
    }
  }

  if (die === undefined) {
    const cropped = cropAndScale(canvas, art, 520);
    if (cropped) {
      die = await readDieCrop(
        { canvas: cropped.canvas, scale: cropped.scale, rect: art },
        readText,
      );
      if (die !== undefined) note = `die OCR ${die}`;
    }
  }

  if (die === undefined) {
    const pips = pipsInRect(canvas, art);
    if (pips >= 1 && pips <= 6) {
      die = pips;
      note = `${pips} pips`;
    }
  }

  if (die !== undefined) {
    return { detection, count: die, source: "dice", note, siblings };
  }

  const fan = countFanInImage(canvas, body);
  const clustered = Math.max(1, siblings.length + 1);
  if (fan >= 4 && fan <= 8 && fan >= clustered) {
    return {
      detection,
      count: fan,
      source: "fan",
      note: `${fan} edges`,
      siblings,
    };
  }

  return {
    detection,
    count: clustered,
    source: "ocr",
    note: clustered > 1 ? "clustered titles" : undefined,
    siblings,
  };
}

async function readDieCrop(
  crop: { canvas: HTMLCanvasElement; scale: number; rect: Rect },
  readText: (input: HTMLCanvasElement) => Promise<OCRRegion[]>,
): Promise<number | undefined> {
  const regions = await readText(crop.canvas);
  const mapped: OCRRegion[] = regions.map((region) => ({
    ...region,
    boundingBox: {
      x: crop.rect.x + region.boundingBox.x / crop.scale,
      y: crop.rect.y + region.boundingBox.y / crop.scale,
      width: region.boundingBox.width / crop.scale,
      height: region.boundingBox.height / crop.scale,
    },
  }));
  return pickBestDieFace(
    mapped.flatMap((region) => {
      const value = parseDieValue(region.text);
      if (value === undefined) return [];
      return [
        {
          value,
          area: region.boundingBox.width * region.boundingBox.height,
          confidence: region.confidence,
          x: region.boundingBox.x,
          y: region.boundingBox.y,
          width: region.boundingBox.width,
          height: region.boundingBox.height,
        },
      ];
    }),
    { x: crop.canvas.width / 2, y: crop.canvas.height / 2 },
  );
}

function dieCropsInRect(
  canvas: HTMLCanvasElement,
  rect: Rect,
): { canvas: HTMLCanvasElement; scale: number; rect: Rect }[] {
  const clipped = clipRect(rect, canvas);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || clipped.width < 16 || clipped.height < 16) return [];
  const image = ctx.getImageData(
    Math.round(clipped.x),
    Math.round(clipped.y),
    Math.round(clipped.width),
    Math.round(clipped.height),
  );
  const { width, height, data } = image;
  const seen = new Uint8Array(width * height);
  const blobs: Rect[] = [];
  for (let i = 0; i < seen.length; i += 1) {
    if (seen[i]) continue;
    const o = i * 4;
    if (!isDiePixel(data[o], data[o + 1], data[o + 2])) continue;
    const blob = floodDie(data, seen, width, height, i);
    if (!blob) continue;
    const area = blob.w * blob.h;
    if (area < 18 * 18 || area > width * height * 0.55) continue;
    const ratio = blob.w / Math.max(1, blob.h);
    if (ratio < 0.55 || ratio > 1.8) continue;
    blobs.push({
      x: clipped.x + blob.x - 8,
      y: clipped.y + blob.y - 8,
      width: blob.w + 16,
      height: blob.h + 16,
    });
  }
  blobs.sort((a, b) => b.width * b.height - a.width * a.height);
  return blobs.slice(0, 3).flatMap((blob) => {
    const cropped = cropAndScale(canvas, clipRect(blob, canvas), 280);
    return cropped ? [{ ...cropped, rect: clipRect(blob, canvas) }] : [];
  });
}

function isDiePixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat > 0.45 && max > 90) return true;
  if (max > 170 && sat < 0.28) return true;
  return max < 55 && sat < 0.35;
}

function floodDie(
  data: Uint8ClampedArray,
  seen: Uint8Array,
  width: number,
  height: number,
  start: number,
): { x: number; y: number; w: number; h: number } | null {
  const stack = [start];
  seen[start] = 1;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let filled = 0;
  while (stack.length > 0) {
    const i = stack.pop();
    if (i === undefined) break;
    const x = i % width;
    const y = Math.floor(i / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    filled += 1;
    const neighbors = [i - 1, i + 1, i - width, i + width];
    for (const next of neighbors) {
      if (next < 0 || next >= seen.length || seen[next]) continue;
      const nx = next % width;
      if (Math.abs(nx - x) > 1) continue;
      const o = next * 4;
      if (!isDiePixel(data[o], data[o + 1], data[o + 2])) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  if (filled < 80) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function nearbySameLands(
  detection: CardDetection,
  all: CardDetection[],
  body: Rect,
): CardDetection[] {
  return all.filter((other) => {
    if (other.id === detection.id) return false;
    if (other.name !== detection.name) return false;
    const otherBody = estimateCardBody(other.boundingBox);
    const gap = Math.max(body.width, otherBody.width) * 1.35;
    const cx = body.x + body.width / 2;
    const cy = body.y + body.height / 2;
    const ox = otherBody.x + otherBody.width / 2;
    const oy = otherBody.y + otherBody.height / 2;
    return Math.hypot(cx - ox, cy - oy) < gap;
  });
}

function dieFacesInRect(
  regions: OCRRegion[],
  body: Rect,
  title: Rect,
): DieFace[] {
  const art = artRect(body, title);
  return regions.flatMap((region) => {
    const value = parseDieValue(region.text);
    if (value === undefined) return [];
    if (!overlaps(region.boundingBox, art)) return [];
    if (iou(region.boundingBox, title) > 0.2) return [];
    const area = region.boundingBox.width * region.boundingBox.height;
    if (area < 24 || area > art.width * art.height * 0.28) return [];
    return [
      {
        value,
        area,
        confidence: region.confidence,
        x: region.boundingBox.x,
        y: region.boundingBox.y,
        width: region.boundingBox.width,
        height: region.boundingBox.height,
      },
    ];
  });
}

function artRect(body: Rect, title: Rect): Rect {
  const y = Math.max(body.y, title.y + title.height);
  return {
    x: body.x,
    y,
    width: body.width,
    height: Math.max(24, body.y + body.height - y) * 0.92,
  };
}

function countFanInImage(canvas: HTMLCanvasElement, body: Rect): number {
  const band = {
    x: body.x + body.width * 0.05,
    y: body.y + body.height * 0.18,
    width: body.width * 1.15,
    height: body.height * 0.42,
  };
  const gray = grayscaleBand(canvas, clipRect(band, canvas));
  if (!gray) return 1;
  return countFanFromProfile(
    verticalEdgeProfile(gray.pixels, gray.width, gray.height),
    Math.max(6, Math.round(body.width * 0.045)),
  );
}

function pipsInRect(canvas: HTMLCanvasElement, rect: Rect): number {
  const clipped = clipRect(rect, canvas);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || clipped.width < 8 || clipped.height < 8) return 0;
  const image = ctx.getImageData(
    Math.round(clipped.x),
    Math.round(clipped.y),
    Math.round(clipped.width),
    Math.round(clipped.height),
  );
  const binary = new Uint8Array(image.width * image.height);
  let dark = 0;
  for (let i = 0; i < binary.length; i += 1) {
    const o = i * 4;
    const luminance =
      0.2126 * image.data[o] + 0.7152 * image.data[o + 1] + 0.0722 * image.data[o + 2];
    if (luminance < 78) {
      binary[i] = 1;
      dark += 1;
    }
  }
  if (dark < 12 || dark > binary.length * 0.45) return 0;
  const pips = countPips(binary, image.width, image.height);
  return pips >= 1 && pips <= 6 ? pips : 0;
}

function grayscaleBand(
  canvas: HTMLCanvasElement,
  rect: Rect,
): { pixels: Float32Array; width: number; height: number } | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || rect.width < 8 || rect.height < 8) return null;
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  const image = ctx.getImageData(Math.round(rect.x), Math.round(rect.y), width, height);
  const pixels = new Float32Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    const o = i * 4;
    pixels[i] =
      0.2126 * image.data[o] + 0.7152 * image.data[o + 1] + 0.0722 * image.data[o + 2];
  }
  return { pixels, width, height };
}

function cropAndScale(
  source: HTMLCanvasElement,
  rect: Rect,
  minWidth: number,
): { canvas: HTMLCanvasElement; scale: number } | null {
  const clipped = clipRect(rect, source);
  if (clipped.width < 12 || clipped.height < 12) return null;
  const scale = Math.max(1, minWidth / clipped.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(clipped.width * scale));
  canvas.height = Math.max(1, Math.round(clipped.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    source,
    clipped.x,
    clipped.y,
    clipped.width,
    clipped.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return { canvas, scale };
}

function clipRect(rect: Rect, canvas: HTMLCanvasElement): Rect {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(canvas.width, rect.x + rect.width) - x),
    height: Math.max(0, Math.min(canvas.height, rect.y + rect.height) - y),
  };
}

function flood(
  binary: Uint8Array,
  seen: Uint8Array,
  width: number,
  height: number,
  start: number,
): { w: number; h: number; filled: number } | null {
  const stack = [start];
  seen[start] = 1;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let filled = 0;
  while (stack.length > 0) {
    const i = stack.pop();
    if (i === undefined) break;
    const x = i % width;
    const y = Math.floor(i / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    filled += 1;
    const neighbors = [i - 1, i + 1, i - width, i + width];
    for (const next of neighbors) {
      if (next < 0 || next >= binary.length || seen[next] || !binary[next]) continue;
      const nx = next % width;
      if (Math.abs(nx - x) > 1) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  if (filled < 6) return null;
  return { w: maxX - minX + 1, h: maxY - minY + 1, filled };
}

function smooth(values: number[], radius: number): number[] {
  return values.map((_, index) => {
    let sum = 0;
    let n = 0;
    for (let i = index - radius; i <= index + radius; i += 1) {
      const value = values[i];
      if (value === undefined) continue;
      sum += value;
      n += 1;
    }
    return n === 0 ? 0 : sum / n;
  });
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[index] ?? 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const a = sorted[mid] ?? 0;
  const b = sorted[mid - 1] ?? a;
  return sorted.length % 2 === 0 ? (a + b) / 2 : a;
}

function maxValue(values: number[]): number {
  return values.reduce((max, value) => (value > max ? value : max), 0);
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function iou(a: Rect, b: Rect): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.width, b.x + b.width) - x;
  const h = Math.min(a.y + a.height, b.y + b.height) - y;
  if (w <= 0 || h <= 0) return 0;
  const intersection = w * h;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}
