import type { Rect } from "../models/detection.ts";
import type { TrainingVerdict } from "../models/training.ts";

export type ReportDetection = {
  detectedText: string;
  name?: string;
  box: Rect;
  verdict: TrainingVerdict;
  correctedText?: string;
  note?: string;
};

export type ReportAddedRegion = {
  box: Rect;
  text: string;
  note?: string;
};

export type TrainingReportInput = {
  filename: string;
  width: number;
  height: number;
  detections: ReportDetection[];
  added: ReportAddedRegion[];
};

function fmtBox(box: Rect): string {
  const round = (value: number) => Math.round(value);
  return `[${round(box.x)}, ${round(box.y)}, ${round(box.width)}, ${round(box.height)}]`;
}

function currentLabel(detection: ReportDetection): string {
  return detection.name ?? detection.detectedText ?? "(no text)";
}

export function buildTrainingReport(input: TrainingReportInput): string {
  const correct = input.detections.filter((d) => d.verdict === "correct");
  const corrected = input.detections.filter(
    (d) => d.verdict === "corrected" && (d.correctedText ?? "").trim().length > 0,
  );
  const falsePositives = input.detections.filter((d) => d.verdict === "not-card");
  const unreviewed = input.detections.filter((d) => d.verdict === "unreviewed");
  const added = input.added.filter((region) => region.text.trim().length > 0);
  const notedDetections = input.detections.filter((d) => (d.note ?? "").trim().length > 0);
  const notedAdded = input.added.filter((region) => (region.note ?? "").trim().length > 0);

  const lines: string[] = [];
  lines.push(
    "Improve the MTG deck scanner's title detection, land counting, and fuzzy matching using this hand-labeled scan.",
  );
  lines.push("");
  lines.push(`Sample: ${input.filename}`);
  lines.push(
    `Prepared image: ${Math.round(input.width)}x${Math.round(input.height)} px ` +
      "(every box below is [x, y, width, height] in these pixels).",
  );
  lines.push("");

  lines.push(`Correct detections (${correct.length}):`);
  if (correct.length === 0) {
    lines.push("- none marked");
  } else {
    for (const d of correct) {
      lines.push(`- "${currentLabel(d)}" ${fmtBox(d.box)}`);
    }
  }
  lines.push("");

  lines.push(`Wrong names to fix (${corrected.length}):`);
  if (corrected.length === 0) {
    lines.push("- none marked");
  } else {
    for (const d of corrected) {
      const detected = d.detectedText || "(empty OCR)";
      lines.push(
        `- detected "${detected}" -> should be "${(d.correctedText ?? "").trim()}" ${fmtBox(d.box)}`,
      );
    }
  }
  lines.push("");

  lines.push(`False positives to suppress (${falsePositives.length}):`);
  if (falsePositives.length === 0) {
    lines.push("- none marked");
  } else {
    for (const d of falsePositives) {
      lines.push(`- "${currentLabel(d)}" ${fmtBox(d.box)} (not a card title)`);
    }
  }
  lines.push("");

  lines.push(`Missed titles to detect (${added.length}):`);
  if (added.length === 0) {
    lines.push("- none marked");
  } else {
    for (const region of added) {
      lines.push(`- "${region.text.trim()}" ${fmtBox(region.box)}`);
    }
  }
  lines.push("");

  if (unreviewed.length > 0) {
    lines.push(`Unreviewed detections (not labeled): ${unreviewed.length}`);
    lines.push("");
  }

  const noteCount = notedDetections.length + notedAdded.length;
  lines.push(`Notes (${noteCount}):`);
  if (noteCount === 0) {
    lines.push("- none");
  } else {
    for (const d of notedDetections) {
      lines.push(`- "${currentLabel(d)}" ${fmtBox(d.box)}: "${(d.note ?? "").trim()}"`);
    }
    for (const region of notedAdded) {
      const label = region.text.trim() || "(unnamed region)";
      lines.push(`- "${label}" ${fmtBox(region.box)}: "${(region.note ?? "").trim()}"`);
    }
  }
  lines.push("");

  lines.push(
    "Use the corrected and missed items as ground truth: adjust title candidate filtering, " +
      "fragment merging, overlap suppression, land dice/fan counting, and the fuzzy matcher so " +
      "these come out right, and drop the false positives. Prefer changes that generalize over " +
      "hard-coding these exact strings.",
  );

  return lines.join("\n");
}
