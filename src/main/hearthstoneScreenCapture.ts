export interface HearthstoneCaptureContext {
  readonly applicationName: string;
  readonly ownerPid: number;
  readonly windowId: number;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface HearthstoneCaptureHost {
  readonly readContext: () => Promise<HearthstoneCaptureContext | undefined>;
  readonly captureWindow: (context: HearthstoneCaptureContext) => Promise<Buffer | undefined>;
}

export class HearthstoneCaptureBoundaryError extends Error {}

export async function captureVerifiedHearthstoneImage(host: HearthstoneCaptureHost): Promise<Buffer> {
  const context = await host.readContext();
  if (!isHearthstoneContext(context)) {
    throw new HearthstoneCaptureBoundaryError("炉石不在前台，已暂停画面识别。");
  }
  const assertCurrent = async () => {
    if (!sameContext(context, await host.readContext())) {
      throw new HearthstoneCaptureBoundaryError("炉石窗口已切换，已丢弃本次截图。");
    }
  };

  await assertCurrent();
  const image = await host.captureWindow(context);
  await assertCurrent();
  if (!image?.length) {
    throw new HearthstoneCaptureBoundaryError("无法读取已验证的炉石画面。");
  }
  return image;
}

function isHearthstoneContext(context: HearthstoneCaptureContext | undefined): context is HearthstoneCaptureContext {
  return context?.applicationName.toLowerCase() === "hearthstone";
}

function sameContext(left: HearthstoneCaptureContext, right: HearthstoneCaptureContext | undefined): boolean {
  return Boolean(
    right &&
    right.applicationName === left.applicationName &&
    right.ownerPid === left.ownerPid &&
    right.windowId === left.windowId &&
    right.bounds.x === left.bounds.x &&
    right.bounds.y === left.bounds.y &&
    right.bounds.width === left.bounds.width &&
    right.bounds.height === left.bounds.height
  );
}
