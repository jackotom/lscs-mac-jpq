import { fireEvent, render, screen } from "@testing-library/react";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel";
import {
  DEFAULT_TRACKER_SETTINGS,
  TrackerSettingsStore
} from "../src/main/trackerSettingsStore";
import type { TrackerSettings } from "../src/shared/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

function settingsWithSmartCounters(enabled = true): TrackerSettings {
  return {
    ...DEFAULT_TRACKER_SETTINGS,
    overlay: {
      ...DEFAULT_TRACKER_SETTINGS.overlay,
      smartCardCounters: enabled
    }
  } as TrackerSettings;
}

describe("independent auxiliary-overlay settings", () => {
  it("exposes four independent switches and updates only the selected switch", () => {
    const settings = settingsWithSmartCounters(true);
    const onChange = vi.fn();
    render(<SettingsPanel settings={settings} onChange={onChange} />);

    const cases = [
      [/我方场攻/, "showFriendlyAttack"],
      [/对手场攻/, "showOpponentAttack"],
      [/奥秘预测/, "secretPrediction"],
      [/智能卡牌计数/, "smartCardCounters"]
    ] as const;

    for (const [label, key] of cases) {
      fireEvent.click(screen.getByRole("switch", { name: label }));
      expect(onChange).toHaveBeenLastCalledWith({
        ...settings,
        overlay: { ...settings.overlay, [key]: !settings.overlay[key] }
      });
    }
  });

  it("migrates saved settings that predate smart counters without losing user choices", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hearthstone-overlay-switches-"));
    temporaryDirectories.push(directory);
    const overlayWithVisibility = DEFAULT_TRACKER_SETTINGS.overlay as TrackerSettings["overlay"] & {
      readonly hiddenSmartCounterIds?: readonly string[];
    };
    const {
      smartCardCounters: _smartCardCounters,
      hiddenSmartCounterIds: _hiddenSmartCounterIds,
      ...previousOverlay
    } = overlayWithVisibility;
    const oldSettings = {
      ...structuredClone(DEFAULT_TRACKER_SETTINGS),
      overlay: {
        ...previousOverlay,
        showFriendlyAttack: true,
        showOpponentAttack: false,
        secretPrediction: false
      }
    };
    await writeFile(
      path.join(directory, "tracker-settings.json"),
      JSON.stringify(oldSettings),
      "utf8"
    );

    const migrated = await new TrackerSettingsStore(directory).read();

    expect(migrated.overlay).toMatchObject({
      showFriendlyAttack: true,
      showOpponentAttack: false,
      secretPrediction: false,
      smartCardCounters: true,
      hiddenSmartCounterIds: []
    });
    await expect(readFile(path.join(directory, "tracker-settings.json"), "utf8").then(JSON.parse))
      .resolves.toMatchObject({ overlay: { smartCardCounters: true, hiddenSmartCounterIds: [] } });
  });

  it("stores each smart counter switch independently in hiddenSmartCounterIds", () => {
    const settings = {
      ...settingsWithSmartCounters(true),
      overlay: {
        ...settingsWithSmartCounters(true).overlay,
        hiddenSmartCounterIds: ["friendly-dragons-played"]
      }
    } as TrackerSettings;
    const smartCounters = [
      { id: "friendly-dragons-played", side: "friendly", label: "龙牌触发", value: 2, target: 5 },
      { id: "opponent-void-souls", side: "opponent", label: "虚空灵魂", value: 3 }
    ] as const;
    const onChange = vi.fn();
    const preview = render(
      <SettingsPanel settings={settings} smartCounters={smartCounters} onChange={onChange} />
    );

    expect(screen.getByRole("switch", { name: /龙牌触发/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: /虚空灵魂/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch", { name: /虚空灵魂/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      overlay: {
        ...settings.overlay,
        hiddenSmartCounterIds: ["friendly-dragons-played", "opponent-void-souls"]
      }
    });

    const bothHidden = onChange.mock.calls.at(-1)?.[0] as TrackerSettings;
    onChange.mockClear();
    preview.rerender(
      <SettingsPanel settings={bothHidden} smartCounters={smartCounters} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("switch", { name: /龙牌触发/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...bothHidden,
      overlay: {
        ...bothHidden.overlay,
        hiddenSmartCounterIds: ["opponent-void-souls"]
      }
    });
  });
});
