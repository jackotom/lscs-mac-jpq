import { describe, expect, it, vi } from "vitest";
import {
  createAppPermissionManager,
  type ScreenCaptureAccessStatus
} from "../src/main/appPermissions";

function manager(initialStatus: ScreenCaptureAccessStatus) {
  let status = initialStatus;
  const requestScreenCapture = vi.fn(async () => undefined);
  const openScreenRecordingSettings = vi.fn(async () => undefined);
  return {
    manager: createAppPermissionManager({
      getScreenCaptureStatus: () => status,
      requestScreenCapture,
      openScreenRecordingSettings
    }),
    setStatus: (next: ScreenCaptureAccessStatus) => { status = next; },
    requestScreenCapture,
    openScreenRecordingSettings
  };
}

describe("app permissions", () => {
  it("reports screen recording as normal only when macOS grants it", () => {
    expect(manager("granted").manager.getPermissions()).toEqual({
      permissions: [{
        id: "screen-recording",
        name: "屏幕录制",
        description: "用于在本机识别炉石模式、套牌和竞技场候选牌。",
        status: "normal",
        statusLabel: "正常",
        actionLabel: undefined
      }]
    });

    expect(manager("denied").manager.getPermissions().permissions[0]).toMatchObject({
      status: "needs-authorization",
      statusLabel: "未授权",
      actionLabel: "点击授权"
    });
  });

  it("requests a never-asked permission only from an explicit user action", async () => {
    const fixture = manager("not-determined");

    await fixture.manager.requestPermission("screen-recording");

    expect(fixture.requestScreenCapture).toHaveBeenCalledOnce();
    expect(fixture.openScreenRecordingSettings).not.toHaveBeenCalled();
  });

  it("does not repeat the system request during the same app run", async () => {
    const fixture = manager("not-determined");

    await fixture.manager.requestPermission("screen-recording");
    await fixture.manager.requestPermission("screen-recording");

    expect(fixture.requestScreenCapture).toHaveBeenCalledOnce();
  });

  it("allows an explicit retry when the first system request fails", async () => {
    const requestScreenCapture = vi.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    const permissionManager = createAppPermissionManager({
      getScreenCaptureStatus: () => "not-determined",
      requestScreenCapture,
      openScreenRecordingSettings: vi.fn(async () => undefined)
    });

    await expect(permissionManager.requestPermission("screen-recording")).rejects.toThrow("temporary failure");
    await expect(permissionManager.requestPermission("screen-recording")).resolves.toBeUndefined();

    expect(requestScreenCapture).toHaveBeenCalledTimes(2);
  });

  it.each(["denied", "restricted", "unknown"] as const)(
    "opens System Settings for %s access instead of triggering capture again",
    async (status) => {
      const fixture = manager(status);

      await fixture.manager.requestPermission("screen-recording");

      expect(fixture.openScreenRecordingSettings).toHaveBeenCalledOnce();
      expect(fixture.requestScreenCapture).not.toHaveBeenCalled();
    }
  );

  it("never performs an authorization action after access is normal", async () => {
    const fixture = manager("granted");

    await fixture.manager.requestPermission("screen-recording");

    expect(fixture.requestScreenCapture).not.toHaveBeenCalled();
    expect(fixture.openScreenRecordingSettings).not.toHaveBeenCalled();
  });
});
