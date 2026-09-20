import { CardOverlay } from "./CardOverlay.tsx";
import { DeckList } from "./DeckList.tsx";
import type { CardIndex } from "../cards/cardIndex.ts";
import type { CardDetection } from "../models/detection.ts";

type ScannerViewProps = {
  imageUrl: string;
  width: number;
  height: number;
  detections: CardDetection[];
  cardIndex: CardIndex | null;
  selectedId?: string;
  onSelect: (detection: CardDetection) => void;
  onAddCard: (name: string) => void;
};

export function ScannerView({
  imageUrl,
  width,
  height,
  detections,
  cardIndex,
  selectedId,
  onSelect,
  onAddCard,
}: ScannerViewProps) {
  return (
    <section className="scanner">
      <div className="stage-wrap">
        <div className="stage" style={{ aspectRatio: `${width} / ${height}` }}>
          <img src={imageUrl} alt="Uploaded deck photo" width={width} height={height} />
          <svg
            className="overlay-root"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <CardOverlay
              detections={detections}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </svg>
        </div>
        <Legend />
      </div>
      <DeckList
        detections={detections}
        cardIndex={cardIndex}
        onSelectDetection={onSelect}
        onAddCard={onAddCard}
      />
    </section>
  );
}

function Legend() {
  return (
    <ul className="legend">
      <li><span className="swatch confirmed" /> Confirmed</li>
      <li><span className="swatch uncertain" /> Uncertain</li>
      <li><span className="swatch unknown" /> Unresolved</li>
      <li><span className="swatch corrected" /> Corrected</li>
    </ul>
  );
}
