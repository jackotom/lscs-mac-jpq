import { Swords } from "lucide-react";

export function SingleAttackOverlay({
  side,
  value
}: {
  readonly side: "friendly" | "opponent";
  readonly value: number;
}) {
  const sideLabel = side === "friendly" ? "我方" : "对手";

  return (
    <main className={`single-attack-overlay single-attack-overlay-${side}`} aria-label={`${sideLabel}场攻悬浮窗`}>
      <output className={`single-attack-counter single-attack-counter-${side}`} aria-label={`${sideLabel}场攻 ${value}`}>
        <span className="board-attack-counter-icon" aria-hidden="true"><Swords /></span>
        <strong className="board-attack-counter-value">{value}</strong>
      </output>
    </main>
  );
}
