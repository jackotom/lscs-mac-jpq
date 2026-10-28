import { useEffect, useRef, useState } from "react";
import type { PublicTrackerState } from "../shared/types";
import { parsePublicTrackerState } from "./runtimeValidation";

export function useDisplayState() {
  const api = window.hearthstoneTracker;
  const [state, setState] = useState<PublicTrackerState>();
  const version = useRef(0);

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const apply = (value: unknown): boolean => {
      try {
        const next = parsePublicTrackerState(value);
        if (!disposed) setState(next);
        return true;
      } catch {
        // Keep the last verified display state.
        return false;
      }
    };
    const unsubscribe = api.onUpdate((value) => { if (apply(value)) version.current += 1; });
    const initialVersion = version.current;
    void api.getState().then((value) => {
      if (!disposed && version.current === initialVersion) apply(value);
    }).catch(() => undefined);
    return () => { disposed = true; unsubscribe(); };
  }, [api]);

  return state;
}
