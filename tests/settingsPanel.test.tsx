import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel";
import type { TrackerSettings } from "../src/shared/types";

const settings: TrackerSettings = {
  ladder: { friendlyDeckTracker: true, opponentDeckTracker: false },
  arena: { friendlyDeckTracker: false, opponentDeckTracker: true },
  general: {
    launchAtLogin: false,
    startMinimized: true,
    showGameStatusIcon: true,
    minimizeToMenuBar: true,
    focusOnOpen: false,
    gameDetection: "automatic",
    gameLanguage: "zh-CN",
    windowMatching: "smart"
  },
  overlay: {
    enabled: true,
    showOnlyInGame: true,
    theme: "light",
    arenaHeroWinRateRanking: false,
    showFriendlyAttack: true,
    showOpponentAttack: true,
    secretPrediction: true,
    smartCardCounters: true,
    position: "right",
    offsetX: 20,
    offsetY: -10,
    opacity: 85,
    hideInFullscreen: false
  },
  appearance: {
    theme: "dark",
    accentColor: "#3b82f6",
    fontSize: "medium",
    zoom: 100,
    animations: true,
    cardImageQuality: "high"
  },
  other: {
    autoUpdateCards: true,
    updateFrequency: "weekly",
    matchRetentionDays: 90,
    notifyUpdates: true,
    notifyAnnouncements: false,
    verboseLogs: false
  }
};

function renderPanel(overrides: Partial<ComponentProps<typeof SettingsPanel>> = {}) {
  const props: ComponentProps<typeof SettingsPanel> = {
    settings,
    onChange: vi.fn(),
    ...overrides
  };
  return { ...render(<SettingsPanel {...props} />), props };
}

describe("software settings", () => {
  it("renders every settings group in one page without an internal menu or window chrome", () => {
    const { container } = renderPanel();

    expect(screen.getByRole("heading", { name: "设置", level: 1 })).toHaveFocus();
    for (const name of ["基础设置", "悬浮窗设置", "快捷键设置", "外观设置", "其他设置", "数据与隐私", "关于我们"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("navigation", { name: "设置分区" })).not.toBeInTheDocument();
    expect(container.querySelector(".settings-window, .settings-window-titlebar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭设置" })).not.toBeInTheDocument();
    expect(screen.getByText(/任何商业使用必须事先取得版权所有者 @jackotom 的书面授权/)).toBeInTheDocument();
  });

  it("uses global deck-tracker switches without ladder or arena tabs", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });

    expect(screen.getByRole("heading", { name: "设置", level: 1 })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "悬浮窗设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "基础设置" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "记牌模式" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: /我方卡牌记牌器/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      ladder: { ...settings.ladder, friendlyDeckTracker: false },
      arena: { ...settings.arena, friendlyDeckTracker: false }
    });
  });

  it("makes position controls explicitly friendly-only and explains independent saved positions", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });

    expect(screen.getByText("这里只调整我方记牌器；对手记牌器和英雄胜率窗会分别保存自己的位置。")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "悬浮窗位置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "水平偏移" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "垂直偏移" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "我方记牌器位置" }), { target: { value: "left" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, overlay: { ...settings.overlay, position: "left" } });
    fireEvent.change(screen.getByRole("slider", { name: "我方水平偏移" }), { target: { value: "40" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, overlay: { ...settings.overlay, offsetX: 40 } });
    fireEvent.change(screen.getByRole("slider", { name: "我方垂直偏移" }), { target: { value: "-30" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, overlay: { ...settings.overlay, offsetY: -30 } });
    fireEvent.change(screen.getByRole("slider", { name: "悬浮窗透明度" }), { target: { value: "70" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, overlay: { ...settings.overlay, opacity: 70 } });
  });

  it("controls the arena hero win-rate ranking window", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });

    fireEvent.click(screen.getByRole("switch", { name: /竞技场英雄胜率排行/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      overlay: { ...settings.overlay, arenaHeroWinRateRanking: true }
    });
  });

  it("controls whether overlays only appear during a game", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });

    fireEvent.click(screen.getByRole("switch", { name: /仅在游戏内显示/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      overlay: { ...settings.overlay, showOnlyInGame: false }
    });
  });

  it("changes the overlay appearance independently from the main window theme", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });

    expect(screen.getByRole("button", { name: "浅色悬浮窗外观设置" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "深色悬浮窗外观设置" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "深色悬浮窗外观设置" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      overlay: { ...settings.overlay, theme: "dark" }
    });
  });

  it("writes general and appearance controls from the combined settings page", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });

    fireEvent.click(screen.getByRole("switch", { name: /开机时自动启动/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, general: { ...settings.general, launchAtLogin: true } });
    expect(screen.getByText("普通启动默认显示主窗口；只有主动开启此项，启动时才会隐藏主窗口。")).toBeInTheDocument();
    expect(screen.getByText("只在打开时带到前面；点击炉石或其他软件后正常退到后面，不会常驻置顶。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /打开软件时将主窗口带到前面/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, general: { ...settings.general, focusOnOpen: true } });
    fireEvent.change(screen.getByRole("combobox", { name: "游戏启动检测" }), { target: { value: "manual" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, general: { ...settings.general, gameDetection: "manual" } });
    fireEvent.click(screen.getByRole("button", { name: "跟随系统主题模式" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, appearance: { ...settings.appearance, theme: "system" } });
    fireEvent.change(screen.getByRole("slider", { name: "界面缩放" }), { target: { value: "110" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, appearance: { ...settings.appearance, zoom: 110 } });
  });

  it("keeps maintenance, privacy, shortcut, loading, and notice behavior on the combined page", () => {
    const actions = {
      onOpenLogFolder: vi.fn(),
      onRefreshCardDatabase: vi.fn(),
      onRestoreDefaults: vi.fn()
    };
    const view = renderPanel({ ...actions, notice: "卡牌数据库已更新" });

    fireEvent.click(screen.getByRole("button", { name: "更新卡牌库" }));
    fireEvent.click(screen.getByRole("button", { name: "打开日志目录" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复默认设置" }));
    expect(actions.onRefreshCardDatabase).toHaveBeenCalledOnce();
    expect(actions.onOpenLogFolder).toHaveBeenCalledOnce();
    expect(actions.onRestoreDefaults).toHaveBeenCalledOnce();
    expect(screen.getByText("Option")).toBeInTheDocument();
    expect(screen.getAllByText("未接入 · 不上传")).toHaveLength(2);
    expect(screen.getByText("卡牌数据库已更新")).toBeInTheDocument();

    view.rerender(<SettingsPanel isLoading onChange={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取设置");
    view.rerender(<SettingsPanel error="设置读取失败" onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("设置读取失败");
  });
});
