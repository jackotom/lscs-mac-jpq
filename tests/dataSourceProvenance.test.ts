import { describe, expect, it } from "vitest";
import {
  CARD_SOURCE_PROVENANCE,
  formatSourceLabel,
  mergeSourceProvenance
} from "../src/shared/dataSourceProvenance.js";

describe("data source provenance", () => {
  it("audit regression: reports a mixed card result instead of relabeling it as official", () => {
    const sources = mergeSourceProvenance([
      CARD_SOURCE_PROVENANCE.blizzardCn,
      CARD_SOURCE_PROVENANCE.hearthstoneJson,
      CARD_SOURCE_PROVENANCE.firestoneCards
    ]);

    expect(formatSourceLabel(sources)).toBe("混合来源：国服炉石卡牌站 + HearthstoneJSON + Firestone 中文卡牌库");
    expect(sources.map((source) => source.authorization.status)).toEqual([
      "pending-confirmation",
      "pending-confirmation",
      "pending-confirmation"
    ]);
  });

  it("audit regression: preserves a single source label without inventing a mixed result", () => {
    expect(formatSourceLabel([CARD_SOURCE_PROVENANCE.blizzardCn])).toBe("国服炉石卡牌站");
  });
});
