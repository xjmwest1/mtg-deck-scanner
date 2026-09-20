import { useEffect, useMemo, useState } from "react";
import type { CardIndex } from "../cards/cardIndex.ts";
import { searchCardNames } from "../cards/fuzzyMatch.ts";
import { isBasicLand } from "../models/deck.ts";
import type { CardDetection, CardMatch } from "../models/detection.ts";

type CardCorrectionDialogProps = {
  detection: CardDetection;
  cardIndex: CardIndex | null;
  onClose: () => void;
  onChoose: (name: string) => void;
  onChangeCount: (count: number) => void;
  onDelete: () => void;
};

export function CardCorrectionDialog({
  detection,
  cardIndex,
  onClose,
  onChoose,
  onChangeCount,
  onDelete,
}: CardCorrectionDialogProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const suggestions = useMemo(() => {
    if (!cardIndex) return detection.matches;
    if (!query.trim()) return detection.matches;
    return searchCardNames(cardIndex, query);
  }, [cardIndex, detection.matches, query]);

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-labelledby="correction-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-kicker">Detected text</p>
        <h2 id="correction-title">{detection.detectedText || "Unknown card"}</h2>
        <p className="dialog-meta">
          {Math.round(detection.confidence * 100)}% match confidence
          {detection.countSource === "dice"
            ? " · counted from a die"
            : detection.countSource === "fan"
              ? " · counted from a sideways fan"
              : ""}
        </p>

        {isBasicLand(detection.name) ? (
          <div className="count-stepper">
            <span>Basic land count</span>
            <span className="count-stepper-row">
              <button
                type="button"
                aria-label="Decrease count"
                onClick={() => onChangeCount(Math.max(1, (detection.count ?? 1) - 1))}
              >
                −
              </button>
              <strong>{detection.count ?? 1}</strong>
              <button
                type="button"
                aria-label="Increase count"
                onClick={() => onChangeCount(Math.min(99, (detection.count ?? 1) + 1))}
              >
                +
              </button>
            </span>
          </div>
        ) : null}

        <label className="search-field">
          <span>Search card names</span>
          <input
            autoFocus
            value={query}
            placeholder="Lightning Bolt"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <ul className="candidate-list">
          {suggestions.map((match) => (
            <CandidateButton
              key={match.name}
              match={match}
              current={detection.name}
              onChoose={onChoose}
            />
          ))}
          {suggestions.length === 0 ? (
            <li className="empty-candidates">No card names match that search.</li>
          ) : null}
        </ul>

        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button-danger" onClick={onDelete}>
            Delete detection
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidateButton({
  match,
  current,
  onChoose,
}: {
  match: CardMatch;
  current?: string;
  onChoose: (name: string) => void;
}) {
  const selected = match.name === current;
  return (
    <li>
      <button
        type="button"
        className={`candidate${selected ? " is-current" : ""}`}
        onClick={() => onChoose(match.name)}
      >
        <span>{selected ? "✓ " : ""}{match.name}</span>
        <em>{Math.round(match.score * 100)}%</em>
      </button>
    </li>
  );
}
