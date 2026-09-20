export type Point = {
  x: number;
  y: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectionStatus =
  | "confirmed"
  | "uncertain"
  | "unknown"
  | "corrected";

export type CardMatch = {
  name: string;
  score: number;
};

export type OCRRegion = {
  text: string;
  confidence: number;
  polygon: Point[];
  boundingBox: Rect;
};

export type CardDetection = {
  id: string;
  name?: string;
  detectedText: string;
  confidence: number;
  polygon: Point[];
  boundingBox: Rect;
  matches: CardMatch[];
  status: DetectionStatus;
  source: "ocr" | "manual";
  count?: number;
  countSource?: "dice" | "fan" | "ocr" | "manual";
};
