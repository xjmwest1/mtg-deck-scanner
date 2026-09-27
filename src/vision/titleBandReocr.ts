import type { OCRRegion, Point, Rect } from "../models/detection.ts";
import { yieldToUi } from "../lib/yieldToUi.ts";
import { enhanceCanvasContrast } from "./preprocess.ts";
import {
  bodyTextReason,
  selectTitleCandidates,
  titleFilterReason,
} from "./titleCandidates.ts";

export type TitleBandReocrReason =
  | "land-row-strip"
  | "land-row"
  | "column-gap"
  | "weak-title";

export type TitleBandReocrAttempt = {
  rect: Rect;
  reason: TitleBandReocrReason;
  texts: string[];
};

export type TitleBandReocrResult = {
  regions: OCRRegion[];
  attempts: TitleBandReocrAttempt[];
};

type PlannedRect = {
  rect: Rect;
  reason: TitleBandReocrReason;
  priority: number;
};

const MAX_ATTEMPTS = 36;
const MIN_TITLE_BAND_WIDTH = 480;
const MIN_TITLE_BAND_HEIGHT = 36;

type TitleColumn = {
  left: number;
  right: number;
  centerX: number;
  anchors: OCRRegion[];
};

export function planTitleBandRects(
  canvas: { width: number; height: number },
  regions: OCRRegion[],
  landmarkRects: Rect[] = [],
): Rect[] {
  return prioritizePlannedRects(
    collectPlannedRects(canvas, regions, landmarkRects),
  ).map((item) => item.rect);
}

export function prioritizePlannedRects(
  planned: PlannedRect[],
): PlannedRect[] {
  return [...planned].sort((a, b) => a.priority - b.priority);
}

export function collectPlannedRects(
  canvas: { width: number; height: number },
  regions: OCRRegion[],
  landmarkRects: Rect[] = [],
): PlannedRect[] {
  const columns = clusterTitleColumns(
    collectColumnAnchors(regions, landmarkRects),
  );
  if (columns.length === 0) return [];

  const planned: PlannedRect[] = [];
  if (!landRowCoveredByRects(canvas, landmarkRects)) {
    planned.push({
      rect: landRowStripRect(canvas),
      reason: "land-row-strip",
      priority: 0,
    });
  }

  for (const column of columns) {
    for (const rect of gapRectsInColumn(column)) {
      planned.push({ rect, reason: "column-gap", priority: 200 + rect.y });
    }
    for (const rect of stackFillRects(column, canvas, regions)) {
      planned.push({
        rect,
        reason: "column-gap",
        priority: 160 + rect.y,
      });
    }
    const landRect = landRowRect(column, canvas, regions);
    if (landRect) {
      planned.push({
        rect: landRect,
        reason: "land-row",
        priority: 100 - column.centerX / Math.max(1, canvas.width),
      });
    }
    for (const rect of weakTitleRects(column, regions)) {
      planned.push({ rect, reason: "weak-title", priority: 300 + rect.y });
    }
  }

  for (const rect of inferMissingLandRowRects(canvas, regions, columns)) {
    planned.push({
      rect,
      reason: "land-row",
      priority: 50 - rect.x / Math.max(1, canvas.width),
    });
  }

  return dedupePlanned(planned);
}

export function mergeOcrRegions(
  base: OCRRegion[],
  added: OCRRegion[],
): OCRRegion[] {
  const merged = [...base];
  for (const region of added) {
    const duplicate = merged.some(
      (existing) =>
        iou(existing.boundingBox, region.boundingBox) > 0.45 &&
        normalizeText(existing.text) === normalizeText(region.text),
    );
    if (duplicate) continue;

    const overlapIndex = merged.findIndex(
      (existing) => iou(existing.boundingBox, region.boundingBox) > 0.45,
    );
    if (overlapIndex >= 0) {
      const existing = merged[overlapIndex];
      if (
        existing &&
        (region.confidence > existing.confidence ||
          (titleFilterReason(existing) && !titleFilterReason(region)))
      ) {
        merged[overlapIndex] = region;
      }
      continue;
    }
    merged.push(region);
  }
  return merged;
}

export function mapRegionToCanvas(
  region: OCRRegion,
  crop: Rect,
  scale: number,
): OCRRegion {
  const mapPoint = (point: Point): Point => ({
    x: crop.x + point.x / scale,
    y: crop.y + point.y / scale,
  });
  const polygon = region.polygon.map(mapPoint);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    ...region,
    polygon,
    boundingBox: {
      x,
      y,
      width: Math.max(...xs) - x,
      height: Math.max(...ys) - y,
    },
  };
}

export async function reocrTitleBands(
  canvas: HTMLCanvasElement,
  regions: OCRRegion[],
  readBand: (input: HTMLCanvasElement) => Promise<OCRRegion[]>,
  landmarkRects: Rect[] = [],
): Promise<TitleBandReocrResult> {
  const planned = prioritizePlannedRects(
    collectPlannedRects(canvas, regions, landmarkRects),
  ).slice(0, MAX_ATTEMPTS);
  if (planned.length === 0) {
    return { regions, attempts: [] };
  }

  const attempts: TitleBandReocrAttempt[] = [];
  let merged = regions;

  for (const item of planned) {
    const reads = await readTitleBand(canvas, item.rect, readBand);
    attempts.push({
      rect: item.rect,
      reason: item.reason,
      texts: reads.map((region) => region.text),
    });
    merged = mergeOcrRegions(merged, reads);
  }

  return { regions: merged, attempts };
}

async function readTitleBand(
  canvas: HTMLCanvasElement,
  rect: Rect,
  readBand: (input: HTMLCanvasElement) => Promise<OCRRegion[]>,
): Promise<OCRRegion[]> {
  const primary = await ocrBandRect(canvas, rect, readBand);
  if (primary.some((region) => titleFilterReason(region) === null)) {
    return primary;
  }

  const expanded = expandRect(rect, canvas, 0.18, 0.85);
  const retry = await ocrBandRect(canvas, expanded, readBand);
  return mergeOcrRegions(primary, retry);
}

async function ocrBandRect(
  canvas: HTMLCanvasElement,
  rect: Rect,
  readBand: (input: HTMLCanvasElement) => Promise<OCRRegion[]>,
): Promise<OCRRegion[]> {
  const crop = cropTitleBand(canvas, rect);
  if (!crop) return [];
  await yieldToUi();
  const local = await readBand(crop.canvas);
  return local.map((region) =>
    mapRegionToCanvas(region, crop.sourceRect, crop.scale),
  );
}

function landRowStripRect(canvas: { width: number; height: number }): Rect {
  const y = canvas.height * 0.665;
  return {
    x: 0,
    y,
    width: canvas.width,
    height: Math.max(36, canvas.height * 0.09),
  };
}

function inferMissingLandRowRects(
  canvas: { width: number; height: number },
  regions: OCRRegion[],
  columns: TitleColumn[],
): Rect[] {
  const landTop = canvas.height * 0.655;
  const landBottom = canvas.height * 0.795;
  const landColumns = columns
    .map((column) => {
      const anchor = column.anchors.find(
        (item) =>
          item.boundingBox.y + item.boundingBox.height / 2 >= landTop &&
          item.boundingBox.y <= landBottom,
      );
      if (!anchor) return null;
      return {
        centerX: column.centerX,
        width: column.right - column.left,
        height: anchor.boundingBox.height,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.centerX - b.centerX);

  if (landColumns.length < 2) return [];

  const spacings: number[] = [];
  for (let i = 1; i < landColumns.length; i += 1) {
    spacings.push(landColumns[i].centerX - landColumns[i - 1].centerX);
  }
  const pitch = median(spacings.filter((gap) => gap >= 40 && gap <= 220));
  if (pitch < 40) return [];

  const height = median(landColumns.map((item) => item.height)) || 18;
  const width = median(landColumns.map((item) => item.width)) || 70;
  const leftMost = landColumns[0]?.centerX ?? 0;
  const rects: Rect[] = [];

  for (
    let centerX = leftMost;
    centerX <= canvas.width * 0.96;
    centerX += pitch
  ) {
    const occupied = landColumns.some(
      (item) => Math.abs(item.centerX - centerX) < pitch * 0.38,
    );
    const rect = titleBandAtCenter(centerX, width, landTop, height);
    if (occupied) {
      if (!hasStrongTitleInBand(regions, rect)) rects.push(rect);
      continue;
    }
    rects.push(rect);
  }

  return rects;
}

function titleBandAtCenter(
  centerX: number,
  width: number,
  y: number,
  height: number,
): Rect {
  const bandWidth = Math.max(48, width * 1.15);
  const bandHeight = Math.max(height * 2.2, 24);
  return {
    x: centerX - bandWidth / 2,
    y: y - height * 0.35,
    width: bandWidth,
    height: bandHeight,
  };
}

function collectColumnAnchors(
  regions: OCRRegion[],
  landmarkRects: Rect[] = [],
): OCRRegion[] {
  const candidates = selectTitleCandidates(regions);
  const relaxed = regions.filter((region) => {
    if (candidates.some((item) => item === region)) return false;
    if (bodyTextReason(region.text)) return false;
    const words = region.text.trim().split(/\s+/).filter(Boolean);
    if (words.length > 6) return false;
    if (region.boundingBox.height > 140 || region.boundingBox.height < 6) {
      return false;
    }
    return countLetters(region.text) >= 2;
  });
  const extras = landmarkRects.map(rectAsAnchor);
  return dedupeRegions([...candidates, ...relaxed, ...extras]);
}

function rectAsAnchor(rect: Rect): OCRRegion {
  return {
    text: "Aa",
    confidence: 0.4,
    polygon: [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ],
    boundingBox: rect,
  };
}

function landRowCoveredByRects(
  canvas: { width: number; height: number },
  rects: Rect[],
): boolean {
  const top = canvas.height * 0.62;
  const bottom = canvas.height * 0.82;
  const hits = rects.filter((rect) => {
    const mid = rect.y + rect.height / 2;
    return mid >= top && mid <= bottom && rect.width >= 28;
  });
  return hits.length >= 4;
}

function clusterTitleColumns(anchors: OCRRegion[]): TitleColumn[] {
  if (anchors.length === 0) return [];
  const sorted = [...anchors].sort(
    (a, b) => centerX(a.boundingBox) - centerX(b.boundingBox),
  );
  const widths = sorted.map((item) => item.boundingBox.width);
  const threshold = Math.max(
    24,
    Math.min(72, (median(widths) || 48) * 0.55),
  );

  const groups: OCRRegion[][] = [];
  for (const anchor of sorted) {
    const cx = centerX(anchor.boundingBox);
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    if (
      current &&
      previous &&
      Math.abs(cx - centerX(previous.boundingBox)) <= threshold
    ) {
      current.push(anchor);
    } else {
      groups.push([anchor]);
    }
  }

  return groups.map((group) => {
    const pad = Math.max(
      6,
      (median(group.map((item) => item.boundingBox.height)) || 14) * 0.25,
    );
    const left = Math.min(...group.map((item) => item.boundingBox.x)) - pad;
    const right =
      Math.max(...group.map((item) => item.boundingBox.x + item.boundingBox.width)) +
      pad;
    return {
      left,
      right,
      centerX: (left + right) / 2,
      anchors: [...group].sort((a, b) => a.boundingBox.y - b.boundingBox.y),
    };
  });
}

function stackFillRects(
  column: TitleColumn,
  canvas: { width: number; height: number },
  regions: OCRRegion[],
): Rect[] {
  const { anchors } = column;
  if (anchors.length === 0) return [];
  const landTop = canvas.height * 0.58;
  const height = median(anchors.map((item) => item.boundingBox.height)) || 16;
  const pitch = inferStackPitch(column) || 56;
  const nonLand = anchors.filter((anchor) => anchor.boundingBox.y < landTop);
  const seeds = nonLand.length > 0 ? nonLand : anchors;
  const top = seeds[0];
  const bottom = seeds[seeds.length - 1];
  if (!top || !bottom) return [];

  const ys: number[] = [];
  for (let y = top.boundingBox.y - pitch, step = 0; y >= 6 && step < 5; y -= pitch, step += 1) {
    ys.push(y);
  }
  for (
    let y = bottom.boundingBox.y + pitch, step = 0;
    y < landTop - 48 && step < 8;
    y += pitch, step += 1
  ) {
    ys.push(y);
  }

  return ys.flatMap((y) => {
    const rect = titleBandRect(column, y, height);
    if (hasStrongTitleInBand(regions, rect)) return [];
    return [rect];
  });
}

function inferStackPitch(column: TitleColumn): number {
  const gaps: number[] = [];
  for (let i = 1; i < column.anchors.length; i += 1) {
    const prev = column.anchors[i - 1];
    const next = column.anchors[i];
    if (!prev || !next) continue;
    const gap = next.boundingBox.y - prev.boundingBox.y;
    if (gap >= 32 && gap <= 90) gaps.push(gap);
  }
  return median(gaps);
}

function gapRectsInColumn(column: TitleColumn): Rect[] {
  const { anchors } = column;
  if (anchors.length < 2) return [];
  const gaps: number[] = [];
  for (let i = 1; i < anchors.length; i += 1) {
    gaps.push(anchors[i].boundingBox.y - anchors[i - 1].boundingBox.y);
  }
  const plausible = gaps.filter((gap) => gap >= 45 && gap <= 190);
  if (plausible.length === 0) return [];
  const stackPitch = Math.min(...plausible);
  const height = median(anchors.map((item) => item.boundingBox.height)) || 16;
  const rects: Rect[] = [];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const top = anchors[i];
    const bottom = anchors[i + 1];
    if (!top || !bottom) continue;
    const gap = bottom.boundingBox.y - top.boundingBox.y;
    if (gap <= stackPitch * 1.55 || gap < 68) continue;
    const steps = Math.max(1, Math.round(gap / stackPitch));
    for (let step = 1; step <= steps; step += 1) {
      const y = top.boundingBox.y + (gap * step) / (steps + 1);
      rects.push(titleBandRect(column, y, height));
    }
  }
  return rects;
}

function landRowRect(
  column: TitleColumn,
  canvas: { width: number; height: number },
  regions: OCRRegion[],
): Rect | null {
  const landAnchors = column.anchors.filter(
    (anchor) => anchor.boundingBox.y >= canvas.height * 0.58,
  );
  if (landAnchors.length > 0) {
    const anchor = landAnchors[landAnchors.length - 1];
    if (!anchor) return null;
    const rect = titleBandRect(column, anchor.boundingBox.y, anchor.boundingBox.height);
    if (hasStrongTitleInBand(regions, rect)) return null;
    return rect;
  }

  const hasSpellTitle = column.anchors.some(
    (anchor) => anchor.boundingBox.y < canvas.height * 0.58,
  );
  if (!hasSpellTitle) return null;
  const height = median(column.anchors.map((item) => item.boundingBox.height)) || 16;
  const rect = titleBandRect(column, canvas.height * 0.70, height);
  if (hasStrongTitleInBand(regions, rect)) return null;
  return rect;
}

function weakTitleRects(column: TitleColumn, regions: OCRRegion[]): Rect[] {
  return column.anchors.flatMap((anchor) => {
    const rect = titleBandRect(column, anchor.boundingBox.y, anchor.boundingBox.height);
    if (hasStrongTitleInBand(regions, rect)) return [];
    return [rect];
  });
}

function hasStrongTitleInBand(regions: OCRRegion[], rect: Rect): boolean {
  const inside = regions.filter((region) => overlapsBand(region.boundingBox, rect));
  return selectTitleCandidates(inside).length > 0;
}

function titleBandRect(column: TitleColumn, y: number, height: number): Rect {
  const padY = Math.max(6, height * 0.45);
  const bandHeight = Math.max(height * 2.2, MIN_TITLE_BAND_HEIGHT * 0.55);
  const columnWidth = Math.max(72, column.right - column.left);
  const centerX = column.centerX;
  return {
    x: centerX - columnWidth / 2,
    y: y - padY,
    width: columnWidth,
    height: bandHeight,
  };
}

function cropTitleBand(
  source: HTMLCanvasElement,
  rect: Rect,
): { canvas: HTMLCanvasElement; sourceRect: Rect; scale: number } | null {
  const clipped = clipRect(rect, source);
  if (clipped.width < 16 || clipped.height < 10) return null;
  const widthScale = MIN_TITLE_BAND_WIDTH / clipped.width;
  const heightScale = MIN_TITLE_BAND_HEIGHT / clipped.height;
  const scale = Math.min(
    Math.max(1, widthScale, heightScale),
    1600 / clipped.width,
    1600 / clipped.height,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(clipped.width * scale));
  canvas.height = Math.max(1, Math.round(clipped.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
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
  enhanceCanvasContrast(canvas);
  sharpenCanvas(canvas);
  return { canvas, sourceRect: clipped, scale };
}

function sharpenCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  const copy = Uint8ClampedArray.from(data);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        let ki = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const o = ((y + ky) * width + (x + kx)) * 4 + c;
            sum += (copy[o] ?? 0) * (kernel[ki] ?? 0);
            ki += 1;
          }
        }
        const o = (y * width + x) * 4 + c;
        data[o] = Math.max(0, Math.min(255, sum));
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

function expandRect(
  rect: Rect,
  canvas: { width: number; height: number },
  padXRatio: number,
  padYRatio: number,
): Rect {
  const padX = rect.width * padXRatio;
  const padY = rect.height * padYRatio;
  return clipRect(
    {
      x: rect.x - padX,
      y: rect.y - padY,
      width: rect.width + padX * 2,
      height: rect.height + padY * 2,
    },
    canvas as HTMLCanvasElement,
  );
}

function dedupePlanned(planned: PlannedRect[]): PlannedRect[] {
  const kept: PlannedRect[] = [];
  for (const item of planned) {
    if (kept.some((other) => iou(other.rect, item.rect) > 0.55)) continue;
    kept.push(item);
  }
  return kept;
}

function dedupeRegions(regions: OCRRegion[]): OCRRegion[] {
  const kept: OCRRegion[] = [];
  for (const region of regions) {
    if (
      kept.some(
        (other) =>
          normalizeText(other.text) === normalizeText(region.text) &&
          iou(other.boundingBox, region.boundingBox) > 0.4,
      )
    ) {
      continue;
    }
    kept.push(region);
  }
  return kept;
}

function clipRect(rect: Rect, canvas: HTMLCanvasElement): Rect {
  const x = Math.max(0, Math.min(canvas.width, Math.round(rect.x)));
  const y = Math.max(0, Math.min(canvas.height, Math.round(rect.y)));
  const right = Math.max(x, Math.min(canvas.width, Math.round(rect.x + rect.width)));
  const bottom = Math.max(y, Math.min(canvas.height, Math.round(rect.y + rect.height)));
  return { x, y, width: right - x, height: bottom - y };
}

function overlapsBand(box: Rect, band: Rect): boolean {
  return (
    horizontalOverlapRatio(box, band) > 0.35 &&
    box.y + box.height / 2 >= band.y &&
    box.y + box.height / 2 <= band.y + band.height
  );
}

function centerX(box: Rect): number {
  return box.x + box.width / 2;
}

function countLetters(text: string): number {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function horizontalOverlapRatio(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const overlap = right - left;
  if (overlap <= 0) return 0;
  return overlap / Math.max(1, Math.min(a.width, b.width));
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
