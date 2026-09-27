import type { CardDetection, Rect } from "../models/detection.ts";
import type {
  AddedRegion,
  DetectionAnnotation,
  TrainingVerdict,
} from "../models/training.ts";

const STORAGE_KEY = "mtg-scanner-training-v1";
const MIN_IOU = 0.35;

type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PersistedDetectionAnnotation = {
  box: NormalizedRect;
  detectedText: string;
  name?: string;
  verdict: TrainingVerdict;
  correctedText?: string;
  note?: string;
};

export type PersistedAddedRegion = {
  box: NormalizedRect;
  text: string;
  note?: string;
};

export type PersistedTrainingLabels = {
  version: 1;
  filename: string;
  updatedAt: string;
  detections: PersistedDetectionAnnotation[];
  added: PersistedAddedRegion[];
};

type TrainingStore = Record<string, PersistedTrainingLabels>;

export function boxIoU(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeRect(box: Rect, width: number, height: number): NormalizedRect {
  return {
    x: box.x / width,
    y: box.y / height,
    width: box.width / width,
    height: box.height / height,
  };
}

function denormalizeRect(box: NormalizedRect, width: number, height: number): Rect {
  return {
    x: box.x * width,
    y: box.y * height,
    width: box.width * width,
    height: box.height * height,
  };
}

function readStore(): TrainingStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TrainingStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: TrainingStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function loadTrainingLabels(filename: string): PersistedTrainingLabels | null {
  const entry = readStore()[filename];
  return entry?.version === 1 ? entry : null;
}

export function saveTrainingLabels(labels: PersistedTrainingLabels): void {
  const store = readStore();
  store[labels.filename] = labels;
  writeStore(store);
}

export function clearTrainingLabels(filename: string): void {
  const store = readStore();
  delete store[filename];
  writeStore(store);
}

export function buildPersistedLabels(
  filename: string,
  width: number,
  height: number,
  detections: CardDetection[],
  annotations: Record<string, DetectionAnnotation>,
  added: AddedRegion[],
): PersistedTrainingLabels {
  const persistedDetections: PersistedDetectionAnnotation[] = [];

  for (const detection of detections) {
    const annotation = annotations[detection.id];
    if (!annotation) continue;
    const hasNote = Boolean(annotation.note?.trim());
    if (annotation.verdict === "unreviewed" && !hasNote) continue;
    persistedDetections.push({
      box: normalizeRect(detection.boundingBox, width, height),
      detectedText: detection.detectedText,
      name: detection.name,
      verdict: annotation.verdict,
      correctedText: annotation.correctedText,
      note: annotation.note?.trim() || undefined,
    });
  }

  return {
    version: 1,
    filename,
    updatedAt: new Date().toISOString(),
    detections: persistedDetections,
    added: added
      .filter((region) => region.text.trim().length > 0 || Boolean(region.note?.trim()))
      .map((region) => ({
        box: normalizeRect(region.box, width, height),
        text: region.text.trim(),
        note: region.note?.trim() || undefined,
      })),
  };
}

export type AppliedTrainingLabels = {
  annotations: Record<string, DetectionAnnotation>;
  added: AddedRegion[];
  restoredCount: number;
};

export function applyPersistedLabels(
  detections: CardDetection[],
  width: number,
  height: number,
  persisted: PersistedTrainingLabels,
): AppliedTrainingLabels {
  const annotations: Record<string, DetectionAnnotation> = {};
  const assigned = new Set<string>();
  let restoredCount = 0;

  for (const saved of persisted.detections) {
    const savedBox = denormalizeRect(saved.box, width, height);
    let bestId: string | undefined;
    let bestIoU = MIN_IOU;

    for (const detection of detections) {
      if (assigned.has(detection.id)) continue;
      const overlap = boxIoU(savedBox, detection.boundingBox);
      if (overlap > bestIoU) {
        bestIoU = overlap;
        bestId = detection.id;
      }
    }

    if (!bestId) continue;

    assigned.add(bestId);
    annotations[bestId] = {
      verdict: saved.verdict,
      correctedText: saved.correctedText,
      note: saved.note,
    };
    restoredCount += 1;
  }

  const added: AddedRegion[] = persisted.added.map((region) => ({
    id: crypto.randomUUID(),
    box: denormalizeRect(region.box, width, height),
    text: region.text,
    note: region.note,
  }));
  restoredCount += added.length;

  return { annotations, added, restoredCount };
}

export function hasMeaningfulLabels(labels: PersistedTrainingLabels): boolean {
  return labels.detections.length > 0 || labels.added.length > 0;
}
