import {
  Bell,
  Database,
  FileText,
  Monitor,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { SmartCardCounter, TrackerModeSettings, TrackerSettings } from "../../shared/types";

type OverlaySettingsWithSmartCounterVisibility = TrackerSettings["overlay"] & {
  readonly hiddenSmartCounterIds?: readonly string[];
};

interface SettingsPanelProps {
  settings?: TrackerSettings;
  smartCounters?: readonly SmartCardCounter[];
  isLoading?: boolean;
  isSaving?: boolean;
  error?: string;
  notice?: string;
  onChange: (next: TrackerSettings) => void;
  onOpenLogFolder?: () => void | Promise<void>;
  onRefreshCardDatabase?: () => void | Promise<void>;
  onRestoreDefaults?: () => void | Promise<void>;
}

type SelectOption<Value extends string | number> = {
  value: Value;
  label: string;
};

const themeChoices: ReadonlyArray<SelectOption<TrackerSettings["appearance"]["theme"]>> = [
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" },
  { value: "system", label: "跟随系统" }
];

const overlayThemeChoices: ReadonlyArray<SelectOption<TrackerSettings["overlay"]["theme"]>> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" }
];

const accentChoices: ReadonlyArray<SelectOption<TrackerSettings["appearance"]["accentColor"]>> = [
  { value: "#3b82f6", label: "蓝色" },
  { value: "#8b5cf6", label: "紫色" },
  { value: "#14b8a6", label: "青色" },
  { value: "#b7791f", label: "棕金" },
  { value: "#f59e0b", label: "琥珀" },
  { value: "#ef4444", label: "红色" }
];

const fontSizeChoices: ReadonlyArray<SelectOption<TrackerSettings["appearance"]["fontSize"]>> = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" }
];

function SectionHeader({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <header className="settings-section-header">
      <h2 id={id}>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function ToggleControl({
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="settings-control-row settings-toggle"
      role="switch"
      aria-checked={checked}
      aria-label={`${label}，${checked ? "已开启" : "已关闭"}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-control-copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className="settings-switch-track" aria-hidden="true"><span /></span>
    </button>
  );
}

function SelectControl<Value extends string | number>({
  label,
  description,
  value,
  options,
  disabled,
  onChange
}: {
  label: string;
  description?: string;
  value: Value;
  options: ReadonlyArray<SelectOption<Value>>;
  disabled?: boolean;
  onChange: (value: Value) => void;
}) {
  return (
    <label className="settings-control-row settings-select-row">
      <span className="settings-control-copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <select
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const selected = options.find((option) => String(option.value) === event.currentTarget.value);
          if (selected) onChange(selected.value);
        }}
      >
        {options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
      </select>
    </label>
  );
}

function RangeControl({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled,
  onChange
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-control-row settings-range-row">
      <span className="settings-control-copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className="settings-range-control">
        <input
          type="range"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <output>{value}{unit}</output>
      </span>
    </label>
  );
}

function ChoiceButtons<Value extends string>({
  label,
  value,
  choices,
  className,
  disabled,
  onChange
}: {
  label: string;
  value: Value;
  choices: ReadonlyArray<SelectOption<Value>>;
  className?: string;
  disabled?: boolean;
  onChange: (value: Value) => void;
}) {
  return (
    <section className="settings-choice-row" aria-label={label}>
      <strong>{label}</strong>
      <div className={className}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={choice.value === value ? "is-selected" : undefined}
            aria-pressed={choice.value === value}
            aria-label={`${choice.label}${label}`}
            disabled={disabled}
            onClick={() => onChange(choice.value)}
          >
            {className === "settings-accent-choices" ? (
              <span className="settings-accent-swatch" style={{ backgroundColor: choice.value }} aria-hidden="true" />
            ) : null}
            <span>{choice.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function SettingsPanel({
  settings,
  smartCounters = [],
  isLoading = false,
  isSaving = false,
  error,
  notice,
  onChange,
  onOpenLogFolder,
  onRefreshCardDatabase,
  onRestoreDefaults
}: SettingsPanelProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const controlsDisabled = !settings;

  useEffect(() => titleRef.current?.focus(), []);

  const updateGeneral = (patch: Partial<TrackerSettings["general"]>) => {
    if (settings) onChange({ ...settings, general: { ...settings.general, ...patch } });
  };

  const updateOverlay = (patch: Partial<TrackerSettings["overlay"]>) => {
    if (settings) onChange({ ...settings, overlay: { ...settings.overlay, ...patch } });
  };

  const updateAppearance = (patch: Partial<TrackerSettings["appearance"]>) => {
    if (settings) onChange({ ...settings, appearance: { ...settings.appearance, ...patch } });
  };

  const updateOther = (patch: Partial<TrackerSettings["other"]>) => {
    if (settings) onChange({ ...settings, other: { ...settings.other, ...patch } });
  };

  const updateDeckTrackers = (patch: Partial<TrackerModeSettings>) => {
    if (!settings) return;
    onChange({
      ...settings,
      ladder: { ...settings.ladder, ...patch },
      arena: { ...settings.arena, ...patch }
    });
  };

  const updateSmartCounterVisibility = (counterId: string, visible: boolean) => {
    if (!settings) return;
    const overlay = settings.overlay as OverlaySettingsWithSmartCounterVisibility;
    const hiddenIds = new Set(overlay.hiddenSmartCounterIds ?? []);
    if (visible) hiddenIds.delete(counterId);
    else hiddenIds.add(counterId);
    onChange({
      ...settings,
      overlay: {
        ...settings.overlay,
        hiddenSmartCounterIds: [...hiddenIds]
      } as TrackerSettings["overlay"]
    });
  };

  const settingsState = !settings ? (
    <p className={`settings-message${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>
      {error ?? (isLoading ? "正在读取设置…" : "设置尚未就绪，请稍后重试。")}
    </p>
  ) : error ? (
    <p className="settings-message is-error" role="alert">{error}</p>
  ) : null;

  const renderGeneral = () => (
    <section className="settings-form-section" aria-labelledby="settings-general-title">
      <SectionHeader id="settings-general-title" title="基础设置" description="控制应用启动、主窗口和炉石识别方式。" />
      {settings ? (
        <div className="settings-control-group">
          <ToggleControl label="开机时自动启动" checked={settings.general.launchAtLogin} disabled={controlsDisabled} onChange={(value) => updateGeneral({ launchAtLogin: value })} />
          <ToggleControl
            label="启动后自动最小化"
            description="普通启动默认显示主窗口；只有主动开启此项，启动时才会隐藏主窗口。"
            checked={settings.general.startMinimized}
            disabled={controlsDisabled}
            onChange={(value) => updateGeneral({ startMinimized: value })}
          />
          <ToggleControl label="在游戏中显示状态图标" checked={settings.general.showGameStatusIcon} disabled={controlsDisabled} onChange={(value) => updateGeneral({ showGameStatusIcon: value })} />
          <ToggleControl label="最小化到菜单栏" checked={settings.general.minimizeToMenuBar} disabled={controlsDisabled} onChange={(value) => updateGeneral({ minimizeToMenuBar: value })} />
          <ToggleControl
            label="打开软件时将主窗口带到前面"
            description="只在打开时带到前面；点击炉石或其他软件后正常退到后面，不会常驻置顶。"
            checked={settings.general.focusOnOpen}
            disabled={controlsDisabled}
            onChange={(value) => updateGeneral({ focusOnOpen: value })}
          />
          <SelectControl label="游戏启动检测" description="自动检查炉石传说是否运行" value={settings.general.gameDetection} options={[{ value: "automatic", label: "自动检测" }, { value: "manual", label: "手动检测" }]} disabled={controlsDisabled} onChange={(value) => updateGeneral({ gameDetection: value })} />
          <SelectControl label="支持的游戏语言" value={settings.general.gameLanguage} options={[{ value: "zh-CN", label: "简体中文" }, { value: "zh-TW", label: "繁体中文" }, { value: "en-US", label: "English" }]} disabled={controlsDisabled} onChange={(value) => updateGeneral({ gameLanguage: value })} />
          <SelectControl label="游戏窗口匹配方式" value={settings.general.windowMatching} options={[{ value: "smart", label: "智能模式（推荐）" }, { value: "title", label: "按窗口标题" }, { value: "process", label: "按游戏进程" }]} disabled={controlsDisabled} onChange={(value) => updateGeneral({ windowMatching: value })} />
        </div>
      ) : null}
    </section>
  );

  const renderOverlay = () => (
    <section className="settings-form-section" aria-labelledby="settings-overlay-title">
      <SectionHeader id="settings-overlay-title" title="悬浮窗设置" description="调整对局内显示内容、位置和透明度。" />
      {settings ? (
        <>
          <div className="settings-control-group">
            <ToggleControl label="悬浮窗总开关" checked={settings.overlay.enabled} disabled={controlsDisabled} onChange={(value) => updateOverlay({ enabled: value })} />
            <ToggleControl
              label="仅在游戏内显示"
              description="打开记牌器不会显示；进入炉石后自动显示，离开游戏后自动隐藏。"
              checked={settings.overlay.showOnlyInGame}
              disabled={controlsDisabled}
              onChange={(value) => updateOverlay({ showOnlyInGame: value })}
            />
            <ChoiceButtons
              label="悬浮窗外观设置"
              value={settings.overlay.theme}
              choices={overlayThemeChoices}
              className="settings-overlay-theme-choices"
              disabled={controlsDisabled}
              onChange={(value) => updateOverlay({ theme: value })}
            />
          </div>

          <div className="settings-control-group">
            <ToggleControl label="我方卡牌记牌器" checked={settings.ladder.friendlyDeckTracker} disabled={controlsDisabled} onChange={(value) => updateDeckTrackers({ friendlyDeckTracker: value })} />
            <ToggleControl label="对手卡牌记牌器" checked={settings.ladder.opponentDeckTracker} disabled={controlsDisabled} onChange={(value) => updateDeckTrackers({ opponentDeckTracker: value })} />
            <ToggleControl label="我方场攻悬浮窗" description="独立打开或关闭我方场攻圆形计数窗" checked={settings.overlay.showFriendlyAttack} disabled={controlsDisabled} onChange={(value) => updateOverlay({ showFriendlyAttack: value })} />
            <ToggleControl label="对手场攻悬浮窗" description="独立打开或关闭对手场攻圆形计数窗" checked={settings.overlay.showOpponentAttack} disabled={controlsDisabled} onChange={(value) => updateOverlay({ showOpponentAttack: value })} />
            <ToggleControl label="奥秘预测悬浮窗" description="独立显示对手奥秘及仍可能的候选" checked={settings.overlay.secretPrediction} disabled={controlsDisabled} onChange={(value) => updateOverlay({ secretPrediction: value })} />
            <ToggleControl label="智能卡牌计数悬浮窗" description="显示龙牌触发进度、虚空灵魂等本局关键计数" checked={settings.overlay.smartCardCounters} disabled={controlsDisabled} onChange={(value) => updateOverlay({ smartCardCounters: value })} />
            {smartCounters.map((counter) => {
              const hiddenIds = (settings.overlay as OverlaySettingsWithSmartCounterVisibility).hiddenSmartCounterIds ?? [];
              const valueLabel = counter.target ? `${counter.value}/${counter.target}` : String(counter.value);
              return (
                <ToggleControl
                  key={counter.id}
                  label={counter.label}
                  description={`当前 ${valueLabel} · 独立悬浮窗`}
                  checked={!hiddenIds.includes(counter.id)}
                  disabled={controlsDisabled}
                  onChange={(value) => updateSmartCounterVisibility(counter.id, value)}
                />
              );
            })}
            <ToggleControl
              label="竞技场英雄胜率排行"
              description="进入竞技场时显示当前版本英雄排行"
              checked={"arenaHeroWinRateRanking" in settings.overlay ? Boolean(settings.overlay.arenaHeroWinRateRanking) : false}
              disabled={controlsDisabled}
              onChange={(value) => updateOverlay({ arenaHeroWinRateRanking: value } as Partial<TrackerSettings["overlay"]>)}
            />
            <ToggleControl label="全屏时自动隐藏" checked={settings.overlay.hideInFullscreen} disabled={controlsDisabled} onChange={(value) => updateOverlay({ hideInFullscreen: value })} />
            <SelectControl
              label="我方记牌器位置"
              description="这里只调整我方记牌器；对手记牌器和英雄胜率窗会分别保存自己的位置。"
              value={settings.overlay.position}
              options={[{ value: "left", label: "左侧" }, { value: "right", label: "右侧" }]}
              disabled={controlsDisabled}
              onChange={(value) => updateOverlay({ position: value })}
            />
            <RangeControl label="我方水平偏移" value={settings.overlay.offsetX} min={-200} max={200} unit=" px" disabled={controlsDisabled} onChange={(value) => updateOverlay({ offsetX: value })} />
            <RangeControl label="我方垂直偏移" value={settings.overlay.offsetY} min={-200} max={200} unit=" px" disabled={controlsDisabled} onChange={(value) => updateOverlay({ offsetY: value })} />
            <RangeControl label="悬浮窗透明度" value={settings.overlay.opacity} min={30} max={100} unit="%" disabled={controlsDisabled} onChange={(value) => updateOverlay({ opacity: value })} />
          </div>
        </>
      ) : null}
    </section>
  );

  const renderShortcuts = () => (
    <section className="settings-form-section" aria-labelledby="settings-shortcuts-title">
      <SectionHeader id="settings-shortcuts-title" title="快捷键设置" description="当前版本只展示已经生效的系统快捷键。" />
      <div className="settings-shortcut-card">
        <div><strong>固定或取消卡牌预览</strong><small>悬停卡牌后使用</small></div>
        <kbd>Option</kbd><span>+</span><kbd>Q</kbd>
      </div>
      <p className="settings-inline-note">本版本暂不支持自定义快捷键。</p>
    </section>
  );

  const renderAppearance = () => (
    <section className="settings-form-section" aria-labelledby="settings-appearance-title">
      <SectionHeader id="settings-appearance-title" title="外观设置" description="调整主题、文字与卡牌图片显示质量。" />
      {settings ? (
        <div className="settings-control-group settings-appearance-controls">
          <ChoiceButtons label="主题模式" value={settings.appearance.theme} choices={themeChoices} className="settings-theme-choices" disabled={controlsDisabled} onChange={(value) => updateAppearance({ theme: value })} />
          <ChoiceButtons label="主题强调色" value={settings.appearance.accentColor} choices={accentChoices} className="settings-accent-choices" disabled={controlsDisabled} onChange={(value) => updateAppearance({ accentColor: value })} />
          <ChoiceButtons label="字体大小" value={settings.appearance.fontSize} choices={fontSizeChoices} className="settings-font-choices" disabled={controlsDisabled} onChange={(value) => updateAppearance({ fontSize: value })} />
          <RangeControl label="界面缩放" value={settings.appearance.zoom} min={80} max={120} unit="%" disabled={controlsDisabled} onChange={(value) => updateAppearance({ zoom: value })} />
          <ToggleControl label="界面动画" checked={settings.appearance.animations} disabled={controlsDisabled} onChange={(value) => updateAppearance({ animations: value })} />
          <SelectControl label="卡牌图片质量" value={settings.appearance.cardImageQuality} options={[{ value: "low", label: "流畅" }, { value: "high", label: "高清" }]} disabled={controlsDisabled} onChange={(value) => updateAppearance({ cardImageQuality: value })} />
        </div>
      ) : null}
    </section>
  );

  const renderOther = () => (
    <section className="settings-form-section" aria-labelledby="settings-other-title">
      <SectionHeader id="settings-other-title" title="其他设置" description="管理卡牌数据库、通知、历史与诊断日志。" />
      {settings ? (
        <>
          <div className="settings-control-group">
            <ToggleControl label="自动更新卡牌数据库" checked={settings.other.autoUpdateCards} disabled={controlsDisabled} onChange={(value) => updateOther({ autoUpdateCards: value })} />
            <SelectControl label="检查更新频率" value={settings.other.updateFrequency} options={[{ value: "daily", label: "每天" }, { value: "weekly", label: "每周" }, { value: "manual", label: "仅手动" }]} disabled={controlsDisabled} onChange={(value) => updateOther({ updateFrequency: value })} />
            <SelectControl label="对局记录保留天数" value={settings.other.matchRetentionDays} options={[{ value: 30, label: "30 天" }, { value: 90, label: "90 天" }, { value: 180, label: "180 天" }]} disabled={controlsDisabled} onChange={(value) => updateOther({ matchRetentionDays: value })} />
            <ToggleControl label="新版本更新提醒" checked={settings.other.notifyUpdates} disabled={controlsDisabled} onChange={(value) => updateOther({ notifyUpdates: value })} />
            <ToggleControl label="版本活动与公告" checked={settings.other.notifyAnnouncements} disabled={controlsDisabled} onChange={(value) => updateOther({ notifyAnnouncements: value })} />
            <ToggleControl label="启用详细日志" description="仅用于本机排障，会增加日志体积" checked={settings.other.verboseLogs} disabled={controlsDisabled} onChange={(value) => updateOther({ verboseLogs: value })} />
          </div>

          <div className="settings-actions" aria-label="设置操作">
            <button type="button" disabled={!onRefreshCardDatabase || isSaving} onClick={() => { void onRefreshCardDatabase?.(); }}><Database aria-hidden="true" size={15} />更新卡牌库</button>
            <button type="button" disabled={!onOpenLogFolder || isSaving} onClick={() => { void onOpenLogFolder?.(); }}><FileText aria-hidden="true" size={15} />打开日志目录</button>
            <button type="button" disabled={!onRestoreDefaults || isSaving} onClick={() => { void onRestoreDefaults?.(); }}><RotateCcw aria-hidden="true" size={15} />恢复默认设置</button>
          </div>
        </>
      ) : null}
    </section>
  );

  const renderPrivacy = () => (
    <section className="settings-form-section" aria-labelledby="settings-privacy-title">
      <SectionHeader id="settings-privacy-title" title="数据与隐私" description="数据默认留在本机；未实现的能力不会伪装成开关。" />
      <div className="settings-note-list">
        <article><ShieldCheck aria-hidden="true" size={17} /><div><strong>本机处理</strong><p>只读取本机炉石日志；画面识别不保存、不上传，也不注入游戏进程。</p></div></article>
        <article><Database aria-hidden="true" size={17} /><div><strong>匿名使用统计</strong><p>未接入，不收集，也不上传使用数据。</p></div><span>未接入 · 不上传</span></article>
        <article><Bell aria-hidden="true" size={17} /><div><strong>天梯排名通知</strong><p>未接入，不读取排名，也不上传排名数据。</p></div><span>未接入 · 不上传</span></article>
      </div>
    </section>
  );

  const renderAbout = () => (
    <section className="settings-form-section" aria-labelledby="settings-about-title">
      <SectionHeader id="settings-about-title" title="关于我们" description="炉石 Mac 记牌器" />
      <div className="settings-about-card">
        <span className="settings-about-mark" aria-hidden="true"><Monitor size={26} /></span>
        <div><strong>炉石盒子 · 桌面伴侣</strong><p>帮助 Mac 玩家查看真实牌库、对局事件与对手公开信息。</p></div>
      </div>
      <p className="settings-inline-note">没有可靠日志时明确等待，不展示虚构对局数据。</p>
    </section>
  );

  return (
    <section className="settings-page settings-page-settings" aria-label="软件设置">
      <header className="settings-header">
        <div className="settings-title-block">
          <span className="settings-title-icon" aria-hidden="true"><Settings size={24} /></span>
          <div>
            <span className="settings-eyebrow">应用偏好</span>
            <h1 ref={titleRef} tabIndex={-1}>设置</h1>
            <p>在同一页中管理基础、悬浮窗、快捷键、外观与其他偏好。</p>
          </div>
        </div>
      </header>

      <main className="settings-section-content settings-single-content">
        {settingsState}
        <div className="settings-all-sections">
          {renderGeneral()}
          {renderOverlay()}
          {renderShortcuts()}
          {renderAppearance()}
          {renderOther()}
          {renderPrivacy()}
          {renderAbout()}
        </div>
        {notice ? <p className="settings-message settings-notice" role="status">{notice}</p> : null}
        {isSaving ? <p className="settings-saving-status" role="status"><RefreshCw aria-hidden="true" size={13} />正在保存设置…</p> : null}
      </main>
    </section>
  );
}
