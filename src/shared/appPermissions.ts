export type AppPermissionId = "screen-recording";
export type AppPermissionStatus = "normal" | "needs-authorization";

export interface AppPermissionItem {
  readonly id: AppPermissionId;
  readonly name: string;
  readonly description: string;
  readonly status: AppPermissionStatus;
  readonly statusLabel: string;
  readonly actionLabel?: string;
}

export interface AppPermissionSummary {
  readonly permissions: readonly AppPermissionItem[];
}
