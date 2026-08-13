import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cardArtworkSources } from "../../shared/cardDatabase";
import type { OverlaySecretCandidate, OverlaySecretSlot } from "../types";

export function SecretOverlay({ slots }: { readonly slots: readonly OverlaySecretSlot[] }) {
  return (
    <div className="secret-overlay-shell">
      <span className="secret-overlay-badge" aria-label="未知奥秘">?</span>
      <main className="secret-overlay" aria-label="对手奥秘预测悬浮窗">
        <header className="secret-overlay-header">
          <strong>奥秘助手</strong>
        </header>

        <div className="secret-overlay-body">
          {slots.length > 0 ? slots.map((slot, index) => {
            const possible = slot.candidates.filter((candidate) => candidate.status === "possible");
            return (
              <section key={slot.id} className="secret-overlay-slot" aria-label={`奥秘 ${index + 1}`}>
                {slots.length > 1 ? (
                  <strong className="secret-overlay-slot-label">{`奥秘 ${index + 1}`}</strong>
                ) : null}
                {possible.length > 0 ? (
                  <ul className="secret-overlay-candidates" aria-label={`奥秘 ${index + 1} 的可能候选`}>
                    {possible.map((candidate) => {
                      const rarity = candidate.details?.rarity?.toLowerCase() ?? "unknown";
                      return (
                        <li key={candidate.id} title={candidate.name}>
                          <span
                            className={`secret-overlay-cost secret-overlay-cost--${rarity}`}
                            aria-label={`${candidate.name}费用`}
                          >
                            {candidate.details?.manaCost ?? "?"}
                          </span>
                          <span className="secret-overlay-card">
                            <SecretCandidateArtwork candidate={candidate} />
                            <span className="secret-overlay-name">{candidate.name}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="secret-overlay-empty">暂无候选</p>}
              </section>
            );
          }) : <p className="secret-overlay-empty">等待对手奥秘</p>}
        </div>
      </main>
    </div>
  );
}

function SecretCandidateArtwork({ candidate }: { readonly candidate: OverlaySecretCandidate }) {
  const sources = cardArtworkSources({
    cardId: candidate.details?.cardId ?? candidate.id,
    cropImageUrl: candidate.details?.cropImageUrl,
    imageUrl: candidate.details?.imageUrl
  });
  const sourcesKey = sources.join("\n");
  const [sourceState, setSourceState] = useState({ key: sourcesKey, index: 0 });
  const sourceIndex = sourceState.key === sourcesKey ? sourceState.index : 0;
  const source = sources[sourceIndex];

  return (
    <span className="secret-overlay-art">
      {source ? (
        <img
          src={source}
          alt=""
          loading="eager"
          decoding="async"
          onError={() => setSourceState((current) => ({
            key: sourcesKey,
            index: (current.key === sourcesKey ? current.index : 0) + 1
          }))}
        />
      ) : (
        <span
          className="secret-overlay-art-fallback"
          aria-label={`${candidate.name}卡图暂不可用`}
          title="卡图暂不可用"
        >
          <ImageOff aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
