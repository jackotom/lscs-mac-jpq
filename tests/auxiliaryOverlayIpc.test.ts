import { describe, expect, it, vi } from "vitest";
import {
  registerAuxiliaryOverlayIpc,
  type AuxiliaryOverlayIpcHost
} from "../src/main/auxiliaryOverlayIpc";

type IpcHandler = (event: { sender: unknown }, ...args: unknown[]) => unknown;

describe("auxiliary overlay IPC", () => {
  it("routes interaction through the sender-owned overlay and rejects forged input", async () => {
    const handlers = new Map<string, IpcHandler>();
    const secretSender = {};
    const attackSender = {};
    const host: AuxiliaryOverlayIpcHost = {
      resolveKind: (sender) => {
        if (sender === secretSender) return "secret";
        if (sender === attackSender) return "friendly-attack";
        return undefined;
      },
      getSecretCollapsed: vi.fn(async () => false),
      setSecretCollapsed: vi.fn(async (collapsed) => collapsed),
      setMouseInteractive: vi.fn(),
      beginDrag: vi.fn(),
      moveDrag: vi.fn(),
      endDrag: vi.fn(async () => undefined)
    };
    registerAuxiliaryOverlayIpc({
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    }, host);

    await expect(handlers.get("tracker:set-secret-overlay-collapsed")?.(
      { sender: secretSender },
      true
    )).resolves.toBe(true);
    await expect(handlers.get("tracker:set-auxiliary-overlay-mouse-interactive")?.(
      { sender: secretSender },
      true
    )).resolves.toBeUndefined();
    await expect(handlers.get("tracker:begin-auxiliary-overlay-drag")?.(
      { sender: attackSender },
      { x: 400, y: 200 }
    )).resolves.toBeUndefined();
    await expect(handlers.get("tracker:move-auxiliary-overlay-drag")?.(
      { sender: attackSender },
      { x: 460, y: 260 }
    )).resolves.toBeUndefined();
    await expect(handlers.get("tracker:end-auxiliary-overlay-drag")?.(
      { sender: attackSender },
      { x: 460, y: 260 }
    )).resolves.toBeUndefined();

    expect(host.setSecretCollapsed).toHaveBeenCalledWith(true);
    expect(host.setMouseInteractive).toHaveBeenCalledWith("secret", true);
    expect(host.beginDrag).toHaveBeenCalledWith("friendly-attack", { x: 400, y: 200 });
    expect(host.moveDrag).toHaveBeenCalledWith("friendly-attack", { x: 460, y: 260 });
    expect(host.endDrag).toHaveBeenCalledWith("friendly-attack", { x: 460, y: 260 });

    await expect(handlers.get("tracker:begin-auxiliary-overlay-drag")?.(
      { sender: secretSender },
      { x: 1, y: 2 }
    )).resolves.toBeUndefined();
    await expect(handlers.get("tracker:move-auxiliary-overlay-drag")?.(
      { sender: secretSender },
      { x: 11, y: 12 }
    )).resolves.toBeUndefined();
    await expect(handlers.get("tracker:end-auxiliary-overlay-drag")?.(
      { sender: secretSender },
      { x: 11, y: 12 }
    )).resolves.toBeUndefined();

    expect(host.beginDrag).toHaveBeenCalledWith("secret", { x: 1, y: 2 });
    expect(host.moveDrag).toHaveBeenCalledWith("secret", { x: 11, y: 12 });
    expect(host.endDrag).toHaveBeenCalledWith("secret", { x: 11, y: 12 });

    await expect(handlers.get("tracker:begin-auxiliary-overlay-drag")?.(
      { sender: {} },
      { x: 1, y: 2 }
    )).rejects.toThrow("无权移动辅助悬浮窗");
    await expect(handlers.get("tracker:move-auxiliary-overlay-drag")?.(
      { sender: attackSender },
      { x: Number.NaN, y: 2 }
    )).rejects.toThrow("拖动坐标无效");
  });

  it("keeps two smart-counter senders isolated without trusting renderer arguments", async () => {
    const handlers = new Map<string, IpcHandler>();
    const firstSender = {};
    const secondSender = {};
    const host: AuxiliaryOverlayIpcHost = {
      resolveKind: (sender) => {
        if (sender === firstSender) return "smart-counter:first";
        if (sender === secondSender) return "smart-counter:second";
        return undefined;
      },
      getSecretCollapsed: vi.fn(async () => false),
      setSecretCollapsed: vi.fn(async (collapsed) => collapsed),
      setMouseInteractive: vi.fn(),
      beginDrag: vi.fn(),
      moveDrag: vi.fn(),
      endDrag: vi.fn(async () => undefined)
    };
    registerAuxiliaryOverlayIpc({
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    }, host);

    await handlers.get("tracker:begin-auxiliary-overlay-drag")?.(
      { sender: firstSender },
      { x: 100, y: 200 },
      "smart-counter:second"
    );
    await handlers.get("tracker:move-auxiliary-overlay-drag")?.(
      { sender: secondSender },
      { x: 300, y: 400 },
      "smart-counter:first"
    );

    expect(host.beginDrag).toHaveBeenCalledWith("smart-counter:first", { x: 100, y: 200 });
    expect(host.moveDrag).toHaveBeenCalledWith("smart-counter:second", { x: 300, y: 400 });
    await expect(handlers.get("tracker:end-auxiliary-overlay-drag")?.(
      { sender: {} },
      { x: 1, y: 2 }
    )).rejects.toThrow("无权移动辅助悬浮窗");
  });
});
