import type { ArenaState } from "../shared/types.js";
import { isHearthstoneFrontmost } from "./frontmostApp.js";

export function shouldShowArenaChoiceOverlay(
  arena: ArenaState | undefined,
  frontmostAppName: string | undefined,
  auxiliaryInteractionActive = false
): boolean {
  return Boolean(
    arena &&
    (arena.status === "drafting" || arena.status === "redrafting") &&
    arena.currentChoices.length >= 2 &&
    (isHearthstoneFrontmost(frontmostAppName) || auxiliaryInteractionActive)
  );
}
