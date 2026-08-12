import { describe, expect, it } from "vitest";
import {
  bindSessionContext,
  createSessionContext,
  createSessionKey,
  hasSessionKey,
  sessionOwnsLogPath
} from "../src/main/trackerSession.js";

describe("tracker session identity", () => {
  it("creates a new identity when the same log path is started again", () => {
    const logs = {
      root: "/tmp/hearthstone",
      sessionDir: "/tmp/hearthstone/session",
      powerLogPath: "/tmp/hearthstone/session/Power.log",
      modifiedAtMs: 1
    };
    const first = bindSessionContext(createSessionContext(createSessionKey(1)), logs, {
      activeLogPath: logs.powerLogPath
    });
    const second = bindSessionContext(createSessionContext(createSessionKey(2)), logs, {
      activeLogPath: logs.powerLogPath
    });

    expect(first.activeLogPath).toBe(second.activeLogPath);
    expect(hasSessionKey(second, first.key)).toBe(false);
    expect(hasSessionKey(second, second.key)).toBe(true);
  });

  it("owns only normalized paths bound to that session", () => {
    const context = bindSessionContext(
      createSessionContext(createSessionKey(1)),
      {
        root: "/tmp/hearthstone",
        sessionDir: "/tmp/hearthstone/session",
        powerLogPath: "/tmp/hearthstone/session/Power.log",
        arenaLogPath: "/tmp/hearthstone/session/Arena.log",
        modifiedAtMs: 1
      },
      {
        activeLogPath: "/tmp/hearthstone/session/Power.log",
        arenaLogPath: "/tmp/hearthstone/session/Arena.log"
      }
    );

    expect(sessionOwnsLogPath(context, "/tmp/hearthstone/session/../session/Power.log", "power")).toBe(true);
    expect(sessionOwnsLogPath(context, "/tmp/hearthstone/old/Power.log", "power")).toBe(false);
    expect(sessionOwnsLogPath(context, "/tmp/hearthstone/session/Arena.log")).toBe(true);
  });
});
