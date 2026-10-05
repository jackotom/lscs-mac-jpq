import { describe, expect, it, vi } from "vitest";
import { captureVerifiedHearthstoneImage, type HearthstoneCaptureContext } from "../src/main/hearthstoneScreenCapture";

const context: HearthstoneCaptureContext = { applicationName: "Hearthstone", ownerPid: 42, windowId: 20, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
describe("audit regression screen capture boundary", () => {
  it("refuses native capture without current Hearthstone ownership", async () => {
    const captureWindow = vi.fn(async () => Buffer.from("hearthstone"));
    await expect(captureVerifiedHearthstoneImage({ readContext: async () => undefined, captureWindow })).rejects.toThrow();
    expect(captureWindow).not.toHaveBeenCalled();
  });
  it("does not return pixels after Hearthstone loses focus during native capture", async () => {
    const readContext = vi.fn().mockResolvedValueOnce(context).mockResolvedValueOnce(context).mockResolvedValue(undefined);
    const captureWindow = vi.fn(async () => Buffer.from("other-app"));
    await expect(captureVerifiedHearthstoneImage({ readContext, captureWindow })).rejects.toThrow();
    expect(captureWindow).toHaveBeenCalledWith(context);
  });
  it("uses only the verified native window when Electron has no window source", async () => {
    const captureWindow = vi.fn(async (received: HearthstoneCaptureContext) => Buffer.from(`window:${received.windowId}:${received.ownerPid}`));
    const image = await captureVerifiedHearthstoneImage({ readContext: async () => context, captureWindow });
    expect(image.toString()).toBe("window:20:42");
    expect(captureWindow).toHaveBeenCalledWith(context);
  });
  it("does not return a screen image when native window capture is unavailable", async () => {
    const captureWindow = vi.fn(async () => undefined);
    await expect(captureVerifiedHearthstoneImage({ readContext: async () => context, captureWindow })).rejects.toThrow();
    expect(captureWindow).toHaveBeenCalledWith(context);
  });
});
