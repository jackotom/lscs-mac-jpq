import { Droplet } from "lucide-react";
import { useAuxiliaryOverlayDrag } from "./useAuxiliaryOverlayDrag";

export function HealthOverlay({
  side,
  value
}: {
  readonly side: "friendly" | "opponent";
  readonly value: number;
}) {
  const sideLabel = side === "friendly" ? "我方" : "对手";
  const dragHandlers = useAuxiliaryOverlayDrag<HTMLOutputElement>();

  return (
    <main className={`health-overlay health-overlay-${side}`} aria-label={`${sideLabel}总血量上限悬浮窗`}>
      <output
        className="health-counter"
        aria-label={`${sideLabel}总血量上限 ${value}`}
        title="拖动调整总血量上限位置"
        {...dragHandlers}
      >
        <Droplet className="health-counter-icon" aria-hidden="true" />
        <strong className="health-counter-value">{value}</strong>
      </output>
    </main>
  );
}
