import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Swords } from "lucide-react";

function toScreenPoint(event: ReactPointerEvent<HTMLElement>) {
  return { x: event.screenX, y: event.screenY };
}

function pointerIdOf(event: ReactPointerEvent<HTMLElement>) {
  return Number.isFinite(event.pointerId) ? event.pointerId : 0;
}

function ignoreRejected(request: Promise<unknown> | undefined): void {
  if (request) void request.catch(() => undefined);
}

export function SingleAttackOverlay({
  side,
  value
}: {
  readonly side: "friendly" | "opponent";
  readonly value: number;
}) {
  const sideLabel = side === "friendly" ? "我方" : "对手";
  const activePointerId = useRef<number | null>(null);
  const isPointerInside = useRef(false);
  const api = window.hearthstoneTracker;

  const finishDrag = (event: ReactPointerEvent<HTMLOutputElement>) => {
    const pointerId = pointerIdOf(event);
    if (activePointerId.current !== pointerId) return;
    activePointerId.current = null;
    if (event.currentTarget.hasPointerCapture?.(pointerId)) {
      event.currentTarget.releasePointerCapture(pointerId);
    }
    ignoreRejected(api?.endAuxiliaryOverlayDrag?.(toScreenPoint(event)));
    if (!isPointerInside.current) {
      ignoreRejected(api?.setAuxiliaryOverlayMouseInteractive?.(false));
    }
  };

  return (
    <main className={`single-attack-overlay single-attack-overlay-${side}`} aria-label={`${sideLabel}场攻悬浮窗`}>
      <output
        className={`single-attack-counter single-attack-counter-${side}`}
        aria-label={`${sideLabel}场攻 ${value}`}
        title="拖动调整场攻位置"
        onPointerEnter={() => {
          isPointerInside.current = true;
          ignoreRejected(api?.setAuxiliaryOverlayMouseInteractive?.(true));
        }}
        onPointerLeave={() => {
          isPointerInside.current = false;
          if (activePointerId.current === null) {
            ignoreRejected(api?.setAuxiliaryOverlayMouseInteractive?.(false));
          }
        }}
        onPointerDown={(event) => {
          if ((event.button ?? 0) !== 0 || activePointerId.current !== null) return;
          const pointerId = pointerIdOf(event);
          activePointerId.current = pointerId;
          event.currentTarget.setPointerCapture?.(pointerId);
          ignoreRejected(api?.beginAuxiliaryOverlayDrag?.(toScreenPoint(event)));
        }}
        onPointerMove={(event) => {
          if (activePointerId.current !== pointerIdOf(event)) return;
          ignoreRejected(api?.moveAuxiliaryOverlayDrag?.(toScreenPoint(event)));
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
      >
        <span className="board-attack-counter-icon" aria-hidden="true"><Swords /></span>
        <strong className="board-attack-counter-value">{value}</strong>
      </output>
    </main>
  );
}
