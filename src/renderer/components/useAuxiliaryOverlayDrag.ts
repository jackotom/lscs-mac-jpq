import { useEffect, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

const dragThreshold = 4;
const maxPassThroughRetryDelay = 1_000;

function toScreenPoint(event: ReactPointerEvent<HTMLElement>) {
  return { x: event.screenX, y: event.screenY };
}

function pointerIdOf(event: ReactPointerEvent<HTMLElement>) {
  return Number.isFinite(event.pointerId) ? event.pointerId : 0;
}

function ignoreRejected(request: Promise<unknown> | undefined): void {
  if (request) void request.catch(() => undefined);
}

export function useAuxiliaryOverlayDrag<ElementType extends HTMLElement>() {
  const activePointerId = useRef<number | null>(null);
  const dragOrigin = useRef<{ readonly x: number; readonly y: number }>();
  const didDrag = useRef(false);
  const desiredMouseInteractive = useRef(false);
  const requestedMouseInteractive = useRef(false);
  const mouseInteractionRequestVersion = useRef(0);
  const mousePassThroughRetryCount = useRef(0);
  const mousePassThroughRetryTimer = useRef<number>();
  const isDisposed = useRef(false);
  const api = window.hearthstoneTracker;

  useEffect(() => {
    isDisposed.current = false;
    return () => {
      isDisposed.current = true;
      mouseInteractionRequestVersion.current += 1;
      if (mousePassThroughRetryTimer.current !== undefined) {
        window.clearTimeout(mousePassThroughRetryTimer.current);
        mousePassThroughRetryTimer.current = undefined;
      }
    };
  }, []);

  const setMouseInteractive = (interactive: boolean, force = false): void => {
    if (isDisposed.current) return;
    desiredMouseInteractive.current = interactive;
    let cancelledRetry = false;
    if (mousePassThroughRetryTimer.current !== undefined) {
      window.clearTimeout(mousePassThroughRetryTimer.current);
      mousePassThroughRetryTimer.current = undefined;
      cancelledRetry = true;
    }
    if (interactive) mousePassThroughRetryCount.current = 0;
    if (!force && requestedMouseInteractive.current === interactive) {
      if (cancelledRetry) mouseInteractionRequestVersion.current += 1;
      return;
    }

    const previous = requestedMouseInteractive.current;
    requestedMouseInteractive.current = interactive;
    const requestVersion = mouseInteractionRequestVersion.current + 1;
    mouseInteractionRequestVersion.current = requestVersion;
    const request = api?.setAuxiliaryOverlayMouseInteractive?.(interactive);
    if (!request) return;

    void request.then(() => {
      if (!isDisposed.current && mouseInteractionRequestVersion.current === requestVersion) {
        mousePassThroughRetryCount.current = 0;
      }
    }).catch(() => {
      if (isDisposed.current || mouseInteractionRequestVersion.current !== requestVersion) return;
      requestedMouseInteractive.current = previous;
      if (interactive || desiredMouseInteractive.current) return;

      mousePassThroughRetryCount.current += 1;
      const retryDelay = Math.min(
        maxPassThroughRetryDelay,
        mousePassThroughRetryCount.current * 50
      );
      mousePassThroughRetryTimer.current = window.setTimeout(() => {
        mousePassThroughRetryTimer.current = undefined;
        if (
          !isDisposed.current
          && mouseInteractionRequestVersion.current === requestVersion
          && !desiredMouseInteractive.current
        ) {
          setMouseInteractive(false, true);
        }
      }, retryDelay);
    });
  };

  const markControlUnderPointer = (_event?: ReactMouseEvent<ElementType> | ReactPointerEvent<ElementType>) => {
    setMouseInteractive(true);
  };

  const markControlLeft = () => {
    if (activePointerId.current === null) {
      setMouseInteractive(false);
    }
  };

  const finishDrag = (event: ReactPointerEvent<ElementType>) => {
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

    ignoreRejected(api?.endAuxiliaryOverlayDrag?.(
      wasDragged ? toScreenPoint(event) : origin ?? toScreenPoint(event)
    ));
    setMouseInteractive(false);
  };

  return {
    onMouseMove: markControlUnderPointer,
    onMouseLeave: markControlLeft,
    onPointerEnter: markControlUnderPointer,
    onPointerLeave: markControlLeft,
    onPointerDown: (event: ReactPointerEvent<ElementType>) => {
      if ((event.button ?? 0) !== 0 || activePointerId.current !== null) return;
      const pointerId = pointerIdOf(event);
      const point = toScreenPoint(event);
      activePointerId.current = pointerId;
      dragOrigin.current = point;
      didDrag.current = false;
      setMouseInteractive(true);
      event.currentTarget.setPointerCapture?.(pointerId);
      ignoreRejected(api?.beginAuxiliaryOverlayDrag?.(point));
    },
    onPointerMove: (event: ReactPointerEvent<ElementType>) => {
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
  } as const;
}
