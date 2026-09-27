import type { Rect } from "./detection.ts";

export type TrainingVerdict = "unreviewed" | "correct" | "corrected" | "not-card";

export type DetectionAnnotation = {
  verdict: TrainingVerdict;
  correctedText?: string;
  note?: string;
};

export type AddedRegion = {
  id: string;
  box: Rect;
  text: string;
  note?: string;
};
