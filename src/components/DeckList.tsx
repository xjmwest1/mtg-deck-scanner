import { useMemo, useState } from "react";
import type { CardIndex } from "../cards/cardIndex.ts";
import { searchCardNames } from "../cards/fuzzyMatch.ts";
import {
  buildDecklist,
  formatDecklistJson,
  formatDecklistText,
} from "../models/deck.ts";
import type { CardDetection } from "../models/detection.ts";

type DeckListProps = {
  detections: CardDetection[];
  cardIndex: CardIndex | null;
  onSelectDetection: (detection: CardDetection) => void;
  onAddCard: (name: string) => void;
};

export function DeckList({
  detections,
  cardIndex,
  onSelectDetection,
  onAddCard,
}: DeckListProps) {
  const decklist = useMemo(() => buildDecklist(detections), [detections]);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const suggestions = useMemo(() => {
    if (!cardIndex || !query.trim()) return [];
    return searchCardNames(cardIndex, query);
  }, [cardIndex, query]);

  async function copyText() {
    const text = formatDecklistText(decklist);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "true");
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function download(kind: "txt" | "json") {
    const body =
      kind === "txt" ? formatDecklistText(decklist) : formatDecklistJson(decklist);
    const blob = new Blob([body], {
      type: kind === "txt" ? "text/plain" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `decklist.${kind}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <aside className="decklist">
      <header>
        <h2>Decklist</h2>
        <p>
          {decklist.total} named
          {decklist.unresolved.length > 0
            ? ` · ${decklist.unresolved.length} unresolved`
            : ""}
        </p>
      </header>

      <ol className="deck-lines">
        {decklist.lines.map((line) => (
          <li key={line.name}>
            <span className="count">{line.count}</span>
            <span>{line.name}</span>
          </li>
        ))}
      </ol>

      {decklist.unresolved.length > 0 ? (
        <section>
          <h3>Needs a look</h3>
          <ul className="unresolved-list">
            {decklist.unresolved.map((detection) => (
              <li key={detection.id}>
                <button type="button" onClick={() => onSelectDetection(detection)}>
                  {detection.detectedText || "Unknown card"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form
        className="add-card"
        onSubmit={(event) => {
          event.preventDefault();
          const first = suggestions[0];
          if (!first) return;
          onAddCard(first.name);
          setQuery("");
        }}
      >
        <label>
          <span>Add a missed card</span>
          <input
            value={query}
            placeholder="Search to add"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {suggestions.length > 0 ? (
          <ul className="add-suggestions">
            {suggestions.map((match) => (
              <li key={match.name}>
                <button
                  type="button"
                  onClick={() => {
                    onAddCard(match.name);
                    setQuery("");
                  }}
                >
                  {match.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </form>

      <div className="export-row">
        <button type="button" onClick={() => void copyText()}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => download("txt")}>
          Download .txt
        </button>
        <button type="button" onClick={() => download("json")}>
          Download .json
        </button>
      </div>
    </aside>
  );
}
