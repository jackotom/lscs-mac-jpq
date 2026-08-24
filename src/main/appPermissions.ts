import type {
  AppPermissionId,
  AppPermissionSummary
} from "../shared/appPermissions.js";

export type ScreenCaptureAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export interface AppPermissionManagerDependencies {
  readonly getScreenCaptureStatus: () => ScreenCaptureAccessStatus;
  readonly requestScreenCapture: () => Promise<void>;
  readonly openScreenRecordingSettings: () => Promise<void>;
}

export function createAppPermissionManager(dependencies: AppPermissionManagerDependencies) {
  let screenCaptureRequest: Promise<void> | undefined;
  let screenCaptureRequestAttempted = false;

  const isScreenCaptureGranted = () => dependencies.getScreenCaptureStatus() === "granted";

  return {
    isScreenCaptureGranted,

    getPermissions(): AppPermissionSummary {
      const granted = isScreenCaptureGranted();
      return {
        permissions: [{
          id: "screen-recording",
          name: "屏幕录制",
          description: "用于在本机识别炉石模式、套牌和竞技场候选牌。",
          status: granted ? "normal" : "needs-authorization",
          statusLabel: granted ? "正常" : "未授权",
          actionLabel: granted ? undefined : "点击授权"
        }]
      };
    },

    async requestPermission(permissionId: AppPermissionId): Promise<void> {
      if (permissionId !== "screen-recording") {
        return;
      }

      const status = dependencies.getScreenCaptureStatus();
      if (status === "granted") {
        return;
      }
      if (status !== "not-determined") {
        await dependencies.openScreenRecordingSettings();
        return;
      }
      if (screenCaptureRequestAttempted) {
        await screenCaptureRequest;
        return;
      }

      screenCaptureRequestAttempted = true;
      screenCaptureRequest = dependencies.requestScreenCapture();
      try {
        await screenCaptureRequest;
      } catch (error) {
        screenCaptureRequestAttempted = false;
        throw error;
      } finally {
        screenCaptureRequest = undefined;
      }
    }
  };
}

export type AppPermissionManager = ReturnType<typeof createAppPermissionManager>;
