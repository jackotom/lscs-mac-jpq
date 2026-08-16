import { useState } from "react";
import { cardArtworkSources } from "../../shared/cardDatabase";
import type { OverlaySmartCounter } from "../types";
import { useAuxiliaryOverlayDrag } from "./useAuxiliaryOverlayDrag";

export function SmartCounterOverlay({ counters }: { readonly counters: readonly OverlaySmartCounter[] }) {
  return (
    <main className="smart-counter-overlay" aria-label="智能卡牌计数悬浮窗">
      {counters.map((counter) => <SmartCounter key={counter.id} counter={counter} />)}
    </main>
  );
}

function SmartCounter({ counter }: { readonly counter: OverlaySmartCounter }) {
  const artwork = artworkSources(counter);
  const [sourceIndex, setSourceIndex] = useState(0);
  const dragHandlers = useAuxiliaryOverlayDrag<HTMLElement>();
  const source = artwork[sourceIndex];
  const progress = counter.target && counter.target > 0
    ? Math.min(100, Math.round((counter.value / counter.target) * 100))
    : undefined;
  const valueLabel = counter.target ? `${counter.value}/${counter.target}` : String(counter.value);

  return (
    <article
      className={`smart-counter-item smart-counter-item-${counter.side ?? "friendly"}`}
      aria-label={`${counter.label} ${valueLabel}`}
      title={`${counter.label} ${valueLabel}`}
      {...dragHandlers}
    >
      <span className="smart-counter-art" aria-hidden="true">
        {source ? (
          <img
            src={source}
            alt=""
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 22%" }}
            onError={() => setSourceIndex((current) => current + 1)}
          />
        ) : <span>{counter.label.slice(0, 1)}</span>}
      </span>
      <strong className="smart-counter-badge">{valueLabel}</strong>
      {progress !== undefined ? (
        <span className="smart-counter-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      ) : null}
    </article>
  );
}

function artworkSources(counter: OverlaySmartCounter): readonly string[] {
  if (counter.details) {
    return cardArtworkSources(counter.details);
  }
  if (counter.imageUrl) {
    return [counter.imageUrl];
  }
  if (counter.cardId) {
    return cardArtworkSources({ cardId: counter.cardId });
  }
  return [];
}
