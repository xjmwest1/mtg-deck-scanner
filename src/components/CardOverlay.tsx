import type { CardDetection } from "../models/detection.ts";

type CardOverlayProps = {
  detections: CardDetection[];
  selectedId?: string;
  onSelect: (detection: CardDetection) => void;
};

const STATUS_LABEL: Record<CardDetection["status"], string> = {
  confirmed: "High confidence",
  uncertain: "Needs review",
  unknown: "Unresolved",
  corrected: "Corrected",
};

export function CardOverlay({
  detections,
  selectedId,
  onSelect,
}: CardOverlayProps) {
  return (
    <g className="overlay" role="group" aria-label="Recognized cards">
      {detections
        .filter((detection) => detection.polygon.length >= 4 && detection.count !== 0)
        .map((detection) => {
          const copies = detection.count && detection.count > 1 ? detection.count : undefined;
          const label = `${copies ? `${copies} ` : ""}${detection.name ?? detection.detectedText ?? "?"}`;
          const { x, y, width, height } = detection.boundingBox;
          const selected = detection.id === selectedId;
          return (
            <g
              key={detection.id}
              className={`overlay-card is-${detection.status}${selected ? " is-selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${STATUS_LABEL[detection.status]}: ${label}`}
              onClick={() => onSelect(detection)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(detection);
                }
              }}
            >
              <title>{`${STATUS_LABEL[detection.status]}: ${label}`}</title>
              <polygon points={toPoints(detection)} />
              <rect
                className="overlay-label-bg"
                x={x}
                y={Math.max(0, y - Math.min(22, height))}
                width={Math.max(width, copies ? 96 : 72)}
                height={18}
                rx={3}
              />
              <text
                x={x + 4}
                y={Math.max(12, y - Math.min(8, height) + 2)}
                className="overlay-label"
              >
                {truncate(label, 28)}
              </text>
            </g>
          );
        })}
    </g>
  );
}

function toPoints(detection: CardDetection): string {
  return detection.polygon.map((point) => `${point.x},${point.y}`).join(" ");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
