import { useState } from "react";
import { ImageOff, ShieldQuestion } from "lucide-react";
import { cardArtworkSources } from "../../shared/cardDatabase";
import type { OverlaySecretCandidate, OverlaySecretSlot } from "../types";

export function SecretOverlay({ slots }: { readonly slots: readonly OverlaySecretSlot[] }) {
  return (
    <main className="secret-overlay" aria-label="对手奥秘预测悬浮窗">
      <header className="secret-overlay-header">
        <span aria-hidden="true"><ShieldQuestion /></span>
        <div>
          <strong>奥秘预测 · {slots.length > 0 ? `${slots.length} 个` : "等待中"}</strong>
        </div>
      </header>

      <div className="secret-overlay-body">
        {slots.length > 0 ? slots.map((slot, index) => {
          const possible = slot.candidates.filter((candidate) => candidate.status === "possible");
          return (
            <section key={slot.id} className="secret-overlay-slot" aria-label={`奥秘 ${index + 1}`}>
              <strong>{`奥秘 ${index + 1} · ${possible.length} 种`}</strong>
              {possible.length > 0 ? (
                <ul className="secret-overlay-candidates" aria-label={`奥秘 ${index + 1} 的可能候选`}>
                  {possible.map((candidate) => (
                    <li key={candidate.id} title={candidate.name}>
                      <SecretCandidateArtwork candidate={candidate} />
                      <span>{candidate.name}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="secret-overlay-candidates">暂无可确认候选</p>}
            </section>
          );
        }) : <p className="secret-overlay-candidates">出现奥秘后自动显示候选</p>}
      </div>
    </main>
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
