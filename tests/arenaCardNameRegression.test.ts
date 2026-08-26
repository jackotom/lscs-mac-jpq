import { describe, expect, it } from "vitest";
import { ArenaDraftEngine } from "../src/shared/arenaDraftEngine";
import { parseArenaLogLine } from "../src/shared/arenaLogParser";

const localizedPickLine = "D 12:06:57.0786310 Client chooses: 通缉海报 (CAP_407)";

describe("Arena localized card names", () => {
  it("keeps the Chinese name together with the card id from a client pick", () => {
    expect(parseArenaLogLine(localizedPickLine)).toEqual([
      expect.objectContaining({
        type: "card-picked",
        cardId: "CAP_407",
        cardName: "通缉海报"
      })
    ]);
  });

  it("displays the Chinese name when the local card database lacks the picked card", () => {
    const engine = new ArenaDraftEngine();
    engine.applyArenaText([
      "D 12:06:00.000 Arena.SetDraftMode - DRAFTING",
      localizedPickLine
    ].join("\n"));

    expect(engine.getState().deck).toEqual([
      expect.objectContaining({ cardId: "CAP_407", name: "通缉海报", count: 1 })
    ]);
  });
});
