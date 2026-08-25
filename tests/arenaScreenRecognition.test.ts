import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ArenaScreenRecognizer,
  ScreenCaptureError,
  cleanupStaleScreenCaptures,
  parseArenaOcrPayload,
  resolveArenaOcrHelperPath,
  selectArenaChoiceTexts
} from "../src/main/arenaScreenRecognition";

describe("arena screen recognition", () => {
  it("does not invoke screen capture while another application is frontmost", async () => {
    const captureScreenImage = vi.fn(async () => Buffer.from("private image"));
    const getFrontmostApp = vi.fn(async () => "Finder");
    const recognizer = new ArenaScreenRecognizer("/missing/helper", captureScreenImage, getFrontmostApp);

    await expect(recognizer.recognize()).resolves.toMatchObject({ status: "window-not-found", texts: [] });
    expect(getFrontmostApp).toHaveBeenCalledOnce();
    expect(captureScreenImage).not.toHaveBeenCalled();
  });

  it("keeps recognition alive and retries after stale capture cleanup fails", async () => {
    const captureScreenImage = vi.fn(async () => Buffer.from("private image"));
    const getFrontmostApp = vi.fn(async () => "Finder");
    const cleanup = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary cleanup failure"))
      .mockResolvedValue(undefined);
    const recognizer = Reflect.construct(ArenaScreenRecognizer, [
      "/missing/helper",
      captureScreenImage,
      getFrontmostApp,
      cleanup
    ]) as ArenaScreenRecognizer;

    await expect(recognizer.recognize()).resolves.toMatchObject({ status: "window-not-found", texts: [] });
    await expect(recognizer.recognize()).resolves.toMatchObject({ status: "window-not-found", texts: [] });
    await expect(recognizer.recognize()).resolves.toMatchObject({ status: "window-not-found", texts: [] });
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("reports stale capture directory scan failures so recognition can retry later", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "arena-screen-cleanup-missing-root-test-"));
    await rm(directory, { recursive: true, force: true });

    await expect(cleanupStaleScreenCaptures(directory, Date.now())).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("removes stale screen captures without touching unrelated temporary files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "arena-screen-cleanup-test-"));
    const staleCapture = path.join(directory, "hearthstone-screen-abandoned");
    const unrelated = path.join(directory, "keep-me");
    await mkdir(staleCapture);
    await writeFile(path.join(staleCapture, "screen.png"), "private image", "utf8");
    await mkdir(unrelated);
    await utimes(staleCapture, new Date(0), new Date(0));

    try {
      await cleanupStaleScreenCaptures(directory, Date.now() - 1_000);
      expect(await readdir(directory)).toEqual(["keep-me"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("can clear a recent abandoned capture during single-instance startup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "arena-screen-startup-cleanup-test-"));
    const abandonedCapture = path.join(directory, "hearthstone-screen-recent");
    const unrelated = path.join(directory, "keep-me");
    await mkdir(abandonedCapture);
    await writeFile(path.join(abandonedCapture, "screen.png"), "private image", "utf8");
    await mkdir(unrelated);

    try {
      await cleanupStaleScreenCaptures(directory, Number.POSITIVE_INFINITY);
      expect(await readdir(directory)).toEqual(["keep-me"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the project native helper during development even when Electron has a resources path", () => {
    const moduleUrl = "file:///project/dist-electron/main/arenaScreenRecognition.js";
    expect(resolveArenaOcrHelperPath("/Electron.app/Contents/Resources", moduleUrl, false))
      .toBe("/project/native/bin/arena-ocr");
  });

  it("uses the bundled Resources helper in a packaged app", () => {
    expect(resolveArenaOcrHelperPath("/Tracker.app/Contents/Resources", import.meta.url, true))
      .toBe("/Tracker.app/Contents/MacOS/arena-ocr");
  });

  it("keeps only the three card-title lanes from an OCR response", () => {
    const result = parseArenaOcrPayload(JSON.stringify({
      status: "ok",
      observations: [
        { text: "小蜘蛛", confidence: 0.99, x: 0.215, y: 0.598, width: 0.04, height: 0.02 },
        { text: "痴醉歌迷", confidence: 0.99, x: 0.366, y: 0.591, width: 0.06, height: 0.03 },
        { text: "致命配方", confidence: 0.99, x: 0.536, y: 0.605, width: 0.05, height: 0.02 },
        { text: "构筑套牌", confidence: 0.99, x: 0.373, y: 0.928, width: 0.06, height: 0.02 },
        { text: "抽两张随从牌", confidence: 0.99, x: 0.527, y: 0.539, width: 0.06, height: 0.02 },
        { text: "造成2点伤害。", confidence: 0.99, x: 0.208, y: 0.542, width: 0.06, height: 0.02 },
        { text: "2", confidence: 0.99, x: 0.331, y: 0.719, width: 0.02, height: 0.04 }
      ]
    }));

    expect(result.status).toBe("ok");
    expect(selectArenaChoiceTexts(result.texts)).toEqual(["小蜘蛛", "痴醉歌迷", "致命配方"]);
  });

  it("keeps card rules text out of the three legendary-team title lanes", () => {
    const result = parseArenaOcrPayload(JSON.stringify({
      status: "ok",
      observations: [
        { text: "希希集", confidence: 1, x: 0.214, y: 0.616, width: 0.044, height: 0.028 },
        { text: "流放", confidence: 0.3, x: 0.234, y: 0.567, width: 0.031, height: 0.019 },
        { text: "伊莉达，寻罪", confidence: 0.3, x: 0.356, y: 0.609, width: 0.085, height: 0.04 },
        { text: "吸血。战吼：将你的牌", confidence: 0.5, x: 0.35, y: 0.565, width: 0.1, height: 0.021 },
        { text: "克罗妮卡", confidence: 0.5, x: 0.532, y: 0.611, width: 0.057, height: 0.035 },
        { text: "战吼：使你的英雄在本", confidence: 1, x: 0.512, y: 0.565, width: 0.1, height: 0.021 }
      ]
    }));

    expect(selectArenaChoiceTexts(result.texts)).toEqual(["希希集", "伊莉达，寻罪", "克罗妮卡"]);
  });

  it("preserves an empty middle lane so the right card cannot shift left", () => {
    expect(selectArenaChoiceTexts([
      { text: "左侧传说", confidence: 1, x: 0.214, y: 0.61, width: 0.06, height: 0.03 },
      { text: "右侧传说", confidence: 1, x: 0.532, y: 0.61, width: 0.06, height: 0.03 }
    ])).toEqual(["左侧传说", "", "右侧传说"]);
  });

  it("fails safely for malformed recognizer output", () => {
    expect(parseArenaOcrPayload("not json")).toMatchObject({ status: "failed", texts: [] });
  });

  it("passes a main-process screen capture to the local OCR helper", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "arena-screen-test-"));
    const helperPath = path.join(directory, "fake-ocr");
    await writeFile(
      helperPath,
      `#!/bin/sh
test "$1" = "--image" || exit 2
test "$(cat "$2")" = "png-data" || exit 3
test "$3" = "--profile" || exit 4
test "$4" = "constructed" || exit 5
printf '%s\\n' '{"status":"ok","observations":[{"text":"偷取牌库","confidence":1,"x":0.72,"y":0.34,"width":0.06,"height":0.02}]}'
`,
      "utf8"
    );
    await chmod(helperPath, 0o755);

    try {
      const captureScreenImage = vi.fn(async () => Buffer.from("png-data"));
      const recognizer = new ArenaScreenRecognizer(helperPath, captureScreenImage);
      const result = await recognizer.recognize({ requireHearthstoneFrontmost: false, profile: "constructed" });

      expect(captureScreenImage).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: "ok", texts: [{ text: "偷取牌库" }] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recovers automatically after screen capture permission becomes available", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "arena-screen-test-"));
    const helperPath = path.join(directory, "fake-ocr");
    await writeFile(
      helperPath,
      `#!/bin/sh
if [ "$1" = "--request-screen-permission" ]; then
  exit 0
fi
test "$1" = "--image" || exit 2
printf '%s\\n' '{"status":"ok","observations":[{"text":"偷取牌库","confidence":1,"x":0.72,"y":0.34,"width":0.06,"height":0.02}]}'
`,
      "utf8"
    );
    await chmod(helperPath, 0o755);

    try {
      const captureScreenImage = vi
        .fn<() => Promise<Buffer>>()
        .mockRejectedValueOnce(new Error("permission denied"))
        .mockResolvedValue(Buffer.from("png-data"));
      const recognizer = new ArenaScreenRecognizer(helperPath, captureScreenImage);

      expect(await recognizer.recognize({ requireHearthstoneFrontmost: false })).toMatchObject({
        status: "permission-denied"
      });
      expect(await recognizer.recognize({ requireHearthstoneFrontmost: false })).toMatchObject({
        status: "ok",
        texts: [{ text: "偷取牌库" }]
      });
      expect(captureScreenImage).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a transient capture failure without treating it as missing permission", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "arena-screen-test-"));
    const helperPath = path.join(directory, "fake-ocr");
    await writeFile(helperPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(helperPath, 0o755);

    try {
      const captureScreenImage = vi.fn(async () => {
        throw new ScreenCaptureError("capture-failed", "temporary capture failure");
      });
      const recognizer = new ArenaScreenRecognizer(helperPath, captureScreenImage);

      expect(await recognizer.recognize({ requireHearthstoneFrontmost: false })).toMatchObject({
        status: "capture-failed",
        message: "temporary capture failure"
      });
      expect(captureScreenImage).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("times out a stuck screen capture so the next recognition can retry", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "arena-screen-test-"));
    const helperPath = path.join(directory, "fake-ocr");
    await writeFile(
      helperPath,
      "#!/bin/sh\nprintf '%s\\n' '{\"status\":\"ok\",\"observations\":[]}'\n",
      "utf8"
    );
    await chmod(helperPath, 0o755);

    try {
      const captureScreenImage = vi
        .fn<() => Promise<Buffer>>()
        .mockImplementationOnce(() => new Promise<Buffer>(() => undefined))
        .mockResolvedValue(Buffer.from("png-data"));
      const recognizer = new ArenaScreenRecognizer(
        helperPath,
        captureScreenImage,
        async () => "Hearthstone",
        async () => undefined,
        20
      );

      await expect(recognizer.recognize()).resolves.toMatchObject({
        status: "capture-failed",
        message: "炉石窗口截图超时，正在自动重试。"
      });
      await expect(recognizer.recognize()).resolves.toMatchObject({ status: "ok" });
      expect(captureScreenImage).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("bounds consecutive stuck captures and resumes after a late capture settles", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "arena-screen-test-"));
    const helperPath = path.join(directory, "fake-ocr");
    await writeFile(
      helperPath,
      "#!/bin/sh\nprintf '%s\\n' '{\"status\":\"ok\",\"observations\":[]}'\n",
      "utf8"
    );
    await chmod(helperPath, 0o755);

    let resolveFirst!: (value: Buffer) => void;
    let resolveSecond!: (value: Buffer) => void;
    const firstCapture = new Promise<Buffer>((resolve) => { resolveFirst = resolve; });
    const secondCapture = new Promise<Buffer>((resolve) => { resolveSecond = resolve; });
    const captureScreenImage = vi
      .fn<() => Promise<Buffer>>()
      .mockImplementationOnce(() => firstCapture)
      .mockImplementationOnce(() => secondCapture)
      .mockResolvedValue(Buffer.from("png-data"));
    const recognizer = new ArenaScreenRecognizer(
      helperPath,
      captureScreenImage,
      async () => "Hearthstone",
      async () => undefined,
      20
    );

    try {
      await expect(recognizer.recognize()).resolves.toMatchObject({ status: "capture-failed" });
      await expect(recognizer.recognize()).resolves.toMatchObject({ status: "capture-failed" });
      await expect(recognizer.recognize()).resolves.toMatchObject({
        status: "capture-failed",
        message: "已有截图请求仍未返回，正在等待系统恢复。"
      });
      expect(captureScreenImage).toHaveBeenCalledTimes(2);

      resolveFirst(Buffer.from("late-png-data"));
      await firstCapture;
      await expect(recognizer.recognize()).resolves.toMatchObject({ status: "ok" });
      expect(captureScreenImage).toHaveBeenCalledTimes(3);
    } finally {
      resolveFirst(Buffer.from("late-png-data"));
      resolveSecond(Buffer.from("late-png-data"));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
