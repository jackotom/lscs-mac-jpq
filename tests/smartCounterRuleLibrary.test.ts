import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as smartCounterRuntime from "../src/shared/smartCounterRules";

type RuleContext = {
  readonly use: {
    readonly entityId: string;
    readonly side: "friendly" | "opponent";
    readonly action: "play";
    readonly cardId?: string;
  };
};

type TestRule = {
  readonly ruleId: string;
  readonly label: string;
  readonly side: "friendly" | "opponent";
  readonly activation: {
    readonly kind: "friendly-deck-card";
    readonly matcher: { readonly cardIds: readonly string[] };
  };
  readonly aggregation: {
    readonly kind: "count" | "distinct";
    readonly matcher: { readonly cardIds: readonly string[] };
    readonly distinctBy?: "card";
  };
  readonly target?: { readonly kind: "fixed"; readonly value: number };
};

type EvaluateSmartCounterRules = (input: {
  readonly rules: readonly TestRule[];
  readonly uses: readonly RuleContext["use"][];
  readonly friendlyDeck: readonly { readonly name: string; readonly count: number; readonly cardId: string }[];
  readonly resolveCard: (cardId?: string) => {
    readonly dbfId: number;
    readonly name: string;
    readonly cardId: string;
    readonly cardType: string;
  } | undefined;
  readonly toDetails: () => undefined;
}) => readonly { readonly id: string; readonly value: number; readonly target?: number }[];

describe("extensible smart-counter rule library", () => {
  it("keeps card-specific rule definitions separate from the generic executor", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const executor = readFileSync(path.join(root, "src/shared/smartCounters.ts"), "utf8");
    const definitions = readFileSync(path.join(root, "src/shared/smartCounterRules.ts"), "utf8");

    expect(definitions).toContain("SMART_COUNTER_RULES");
    expect(definitions).toMatch(/JAIL_732|jail_732/);
    expect(definitions).toMatch(/dragon|龙/iu);
    const runtime = definitions.slice(definitions.indexOf("export function evaluateSmartCounterRules"));
    expect(executor).toMatch(/evaluateSmartCounterRules/);
    expect(runtime).toMatch(/evaluateSmartCounterRules/);
    expect(runtime).not.toMatch(/JAIL_732|jail_732/);
    expect(runtime).not.toMatch(/使用过.*张其他龙牌/u);
    expect(runtime).toContain("options.rules ?? SMART_COUNTER_RULES");
    expect(executor).not.toMatch(/JAIL_732|jail_732/);
    expect(executor).not.toMatch(/使用过.*张其他龙牌/u);
  });

  it("executes count, progress, and distinct aggregation through one generic path", () => {
    const evaluate = (smartCounterRuntime as unknown as {
      readonly evaluateSmartCounterRules?: EvaluateSmartCounterRules;
    }).evaluateSmartCounterRules;
    expect(evaluate).toBeTypeOf("function");
    if (!evaluate) throw new Error("missing evaluateSmartCounterRules");

    const rules: readonly TestRule[] = [
      {
        ruleId: "test-count",
        label: "计数",
        side: "friendly",
        activation: { kind: "friendly-deck-card", matcher: { cardIds: ["TRIGGER"] } },
        aggregation: { kind: "count", matcher: { cardIds: ["CARD_A", "CARD_B"] } }
      },
      {
        ruleId: "test-progress",
        label: "进度",
        side: "friendly",
        activation: { kind: "friendly-deck-card", matcher: { cardIds: ["TRIGGER"] } },
        aggregation: { kind: "count", matcher: { cardIds: ["CARD_A", "CARD_B"] } },
        target: { kind: "fixed", value: 3 }
      },
      {
        ruleId: "test-distinct",
        label: "去重",
        side: "friendly",
        activation: { kind: "friendly-deck-card", matcher: { cardIds: ["TRIGGER"] } },
        aggregation: {
          kind: "distinct",
          matcher: { cardIds: ["CARD_A", "CARD_B"] },
          distinctBy: "card"
        }
      }
    ];
    const uses = [
      { entityId: "1", side: "friendly", action: "play", cardId: "CARD_A" },
      { entityId: "2", side: "friendly", action: "play", cardId: "CARD_A" },
      { entityId: "3", side: "friendly", action: "play", cardId: "CARD_B" },
      { entityId: "4", side: "opponent", action: "play", cardId: "CARD_A" }
    ] as const;
    const cards = new Map([
      ["TRIGGER", { dbfId: 1, name: "触发牌", cardId: "TRIGGER", cardType: "MINION" }],
      ["CARD_A", { dbfId: 2, name: "甲", cardId: "CARD_A", cardType: "SPELL" }],
      ["CARD_B", { dbfId: 3, name: "乙", cardId: "CARD_B", cardType: "SPELL" }]
    ] as const);

    expect(evaluate({
      rules,
      uses,
      friendlyDeck: [{ name: "触发牌", count: 1, cardId: "TRIGGER" }],
      resolveCard: (cardId) => cardId ? cards.get(cardId as "TRIGGER" | "CARD_A" | "CARD_B") : undefined,
      toDetails: () => undefined
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "test-count", value: 3 }),
      expect.objectContaining({ id: "test-progress", value: 3, target: 3 }),
      expect.objectContaining({ id: "test-distinct", value: 2 })
    ]));
  });
});
