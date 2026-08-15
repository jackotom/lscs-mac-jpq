import { useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { ImageOff } from "lucide-react";
import { cardArtworkSources } from "../../shared/cardDatabase";
import type { OverlaySecretCandidate, OverlaySecretSlot } from "../types";

function ignoreRejected(request: Promise<unknown> | undefined): void {
  if (request) void request.catch(() => undefined);
}

const dragThreshold = 4;

function toScreenPoint(event: ReactPointerEvent<HTMLElement>) {
  return { x: event.screenX, y: event.screenY };
}

function pointerIdOf(event: ReactPointerEvent<HTMLElement>) {
  return Number.isFinite(event.pointerId) ? event.pointerId : 0;
}

export function SecretOverlay({
  slots,
  isCollapsed = false,
  onCollapsedChange
}: {
  readonly slots: readonly OverlaySecretSlot[];
  readonly isCollapsed?: boolean;
  readonly onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const activePointerId = useRef<number | null>(null);
  const dragOrigin = useRef<{ readonly x: number; readonly y: number }>();
  const didDrag = useRef(false);
  const suppressNextClick = useRef(false);
  const isPointerInsideControl = useRef(false);
  const isMouseInteractive = useRef(false);
  const mouseInteractionRequestVersion = useRef(0);
  const mousePassThroughRetryCount = useRef(0);
  const api = window.hearthstoneTracker;

  const setMouseInteractive = (interactive: boolean) => {
    if (isMouseInteractive.current === interactive) return;
    const previous = isMouseInteractive.current;
    isMouseInteractive.current = interactive;
    const request = api?.setAuxiliaryOverlayMouseInteractive?.(interactive);
    if (!request) return;

    const requestVersion = mouseInteractionRequestVersion.current + 1;
    mouseInteractionRequestVersion.current = requestVersion;
    void request.then(() => {
      if (mouseInteractionRequestVersion.current === requestVersion) {
        mousePassThroughRetryCount.current = 0;
      }
    }).catch(() => {
      if (mouseInteractionRequestVersion.current !== requestVersion) return;
      isMouseInteractive.current = previous;
      if (interactive || mousePassThroughRetryCount.current >= 3) return;

      mousePassThroughRetryCount.current += 1;
      window.setTimeout(() => {
        if (
          mouseInteractionRequestVersion.current === requestVersion &&
          isMouseInteractive.current
        ) {
          setMouseInteractive(false);
        }
      }, mousePassThroughRetryCount.current * 50);
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointerId = pointerIdOf(event);
    if (activePointerId.current !== pointerId) return;

    const origin = dragOrigin.current;
    const wasDragged = didDrag.current;
    activePointerId.current = null;
    dragOrigin.current = undefined;
    didDrag.current = false;
    if (event.currentTarget.hasPointerCapture?.(pointerId)) {
      event.currentTarget.releasePointerCapture(pointerId);
    }

    const endPoint = wasDragged ? toScreenPoint(event) : origin ?? toScreenPoint(event);
    ignoreRejected(api?.endAuxiliaryOverlayDrag?.(endPoint));
    suppressNextClick.current = wasDragged && event.type === "pointerup";
    if (suppressNextClick.current) {
      window.setTimeout(() => {
        suppressNextClick.current = false;
      }, 0);
    }
    if (wasDragged || event.type !== "pointerup" || !isPointerInsideControl.current) {
      setMouseInteractive(false);
    }
  };

  const markControlUnderPointer = () => {
    isPointerInsideControl.current = true;
    setMouseInteractive(true);
  };

  const markControlLeft = () => {
    isPointerInsideControl.current = false;
    if (activePointerId.current === null) {
      setMouseInteractive(false);
    }
  };

  const handleControlClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onCollapsedChange?.(!isCollapsed);
    setMouseInteractive(false);
  };

  const dragControlHandlers = {
    onClick: handleControlClick,
    onMouseMove: markControlUnderPointer,
    onMouseLeave: markControlLeft,
    onPointerEnter: markControlUnderPointer,
    onPointerLeave: markControlLeft,
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if ((event.button ?? 0) !== 0 || activePointerId.current !== null) return;
      const pointerId = pointerIdOf(event);
      const point = toScreenPoint(event);
      activePointerId.current = pointerId;
      dragOrigin.current = point;
      didDrag.current = false;
      suppressNextClick.current = false;
      setMouseInteractive(true);
      event.currentTarget.setPointerCapture?.(pointerId);
      ignoreRejected(api?.beginAuxiliaryOverlayDrag?.(point));
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (activePointerId.current !== pointerIdOf(event)) return;
      const origin = dragOrigin.current;
      if (!origin) return;
      const point = toScreenPoint(event);
      if (!didDrag.current) {
        if (Math.hypot(point.x - origin.x, point.y - origin.y) < dragThreshold) return;
        didDrag.current = true;
      }
      ignoreRejected(api?.moveAuxiliaryOverlayDrag?.(point));
    },
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onLostPointerCapture: finishDrag
  };

  return (
    <div className={`secret-overlay-shell${isCollapsed ? " secret-overlay-shell--collapsed" : ""}`}>
      <button
        type="button"
        className="secret-overlay-badge"
        aria-controls="secret-overlay-panel"
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? "展开奥秘助手" : "收起奥秘助手"}
        title={isCollapsed ? "点击展开，拖动移动" : "点击收起，拖动移动"}
        {...dragControlHandlers}
      >
        <span className="secret-overlay-badge-face" aria-hidden="true">?</span>
      </button>
      {!isCollapsed ? <main id="secret-overlay-panel" className="secret-overlay" aria-label="对手奥秘预测悬浮窗">
        <header className="secret-overlay-header">
          <button
            type="button"
            className="secret-overlay-title-control"
            aria-controls="secret-overlay-panel"
            aria-expanded="true"
            aria-label="收起或拖动奥秘助手"
            title="点击收起，拖动移动"
            {...dragControlHandlers}
          >
            <strong>奥秘助手</strong>
          </button>
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
      </main> : null}
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
