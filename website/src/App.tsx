import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  Github,
  Menu,
  Monitor,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";

const releaseUrl = import.meta.env.VITE_DOWNLOAD_URL || "https://acyg.me/lsjpq/hearthstone-tracker-mac-arm64-v0.6.7.zip";
const changelogUrl = "https://github.com/jackotom/lscs-mac-jpq/blob/main/CHANGELOG.md";

const navItems = [
  ["功能", "#features"],
  ["实战界面", "#tracker"],
  ["竞技场", "#arena"],
  ["隐私", "#privacy"],
  ["安装", "#install"],
] as const;

const overview = [
  { number: "01", title: "实时记牌", copy: "自动识别套牌，牌库、手牌与对手行动同步更新。", href: "#tracker" },
  { number: "02", title: "对局内悬浮", copy: "我方与对手信息独立置顶，不遮挡画面，不抢焦点。", href: "#overlay" },
  { number: "03", title: "竞技场选牌", copy: "四项关键数据并排呈现，选择依据更清楚。", href: "#arena" },
] as const;

function Brand() {
  return (
    <a className="brand" href="#top" aria-label="炉石记牌器首页">
      <span>炉石记牌器</span>
    </a>
  );
}

function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="nav-shell">
        <Brand />
        <nav className={open ? "nav-links is-open" : "nav-links"} aria-label="主要导航">
          {navItems.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>
          ))}
          <a className="mobile-release" href={changelogUrl}>更新记录</a>
        </nav>
        <a className="nav-download" href={releaseUrl} target="_blank" rel="noreferrer">
          下载公开版 <Download size={17} aria-hidden="true" />
        </a>
        <button className="menu-button" type="button" onClick={() => setOpen(!open)} aria-label={open ? "关闭菜单" : "打开菜单"} aria-expanded={open}>
          {open ? <X /> : <Menu />}
        </button>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-inner">
        <div className="hero-copy">
          <h1>每一张牌，<br />都心里有数。</h1>
          <p>专为 Apple 芯片 Mac 打造。自动识别套牌，实时追踪牌库、对手已出牌与竞技场选牌。只在本机运行，不读内存，不打扰操作。</p>
          <div className="hero-actions">
            <a className="button button-primary" href={releaseUrl} target="_blank" rel="noreferrer">
              下载公开版 v0.6.7 <Download size={20} />
            </a>
            <a className="text-link" href="#tracker">查看实际界面 <ArrowRight size={18} /></a>
          </div>
          <span className="compatibility">macOS 12+ · Apple 芯片 · 约 117 MB</span>
        </div>

        <div className="hero-visual" aria-label="炉石记牌器真实界面预览">
          <div className="app-window">
            <img src="./home-dashboard.png" alt="炉石记牌器首页，显示套牌、战绩和公开数据" />
          </div>
          <div className="overlay-window friendly">
            <img src="./friendly-overlay.png" alt="我方牌库悬浮窗" />
          </div>
          <div className="overlay-window opponent">
            <img src="./opponent-overlay.png" alt="对手已出牌悬浮窗" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Overview() {
  return (
    <section className="section overview" id="features">
      <div className="section-head centered">
        <h2>全局追踪，一目了然。</h2>
        <p>从识别套牌到回顾对局，只展示能帮助你判断的信息。</p>
      </div>
      <div className="overview-grid">
        {overview.map((item) => (
          <a href={item.href} className="overview-item" key={item.number}>
            <span className="number">{item.number}</span>
            <div><h3>{item.title}</h3><p>{item.copy}</p></div>
            <ChevronRight aria-hidden="true" />
          </a>
        ))}
      </div>
    </section>
  );
}

function ProductFrame({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <figure className={`product-frame ${className}`}>
      <img src={src} alt={alt} loading="lazy" />
    </figure>
  );
}

function FeatureStories() {
  return (
    <>
      <section className="section story" id="tracker">
        <div className="story-copy">
          <span className="section-number">01</span>
          <h2>牌局变化，<br />跟着日志实时更新。</h2>
          <p>打开一局后自动识别当前套牌。我方剩余牌库、手牌、场面、墓地，以及对手已使用卡牌，都在同一处清楚呈现。</p>
          <ul className="check-list">
            <li><Check /> 自动识别构筑与竞技场牌库</li>
            <li><Check /> 关键卡牌和公开计数独立显示</li>
            <li><Check /> 证据不足时明确显示未知，不乱猜</li>
          </ul>
        </div>
        <ProductFrame src="./live-workbench.png" alt="实时对局工作台，显示我方牌库、事件流和对手记录" />
      </section>

      <section className="section overlay-story" id="overlay">
        <div className="story-copy">
          <span className="section-number">02</span>
          <h2>信息置顶，<br />注意力留在牌桌。</h2>
          <p>我方牌库、对手行动、双方场攻和奥秘候选各自独立。悬浮窗只在需要时出现，不抢游戏焦点。</p>
          <div className="inline-facts">
            <span><Monitor /> 游戏内置顶</span>
            <span><Target /> 不自动操作</span>
          </div>
        </div>
        <div className="overlay-stage">
          <figure className="overlay-card friendly-card">
            <figcaption>我的牌库</figcaption>
            <div className="friendly-crop"><img src="./friendly-overlay.png" alt="我方牌库悬浮窗实际界面" loading="lazy" /></div>
          </figure>
          <figure className="overlay-card opponent-card">
            <figcaption>对手记录</figcaption>
            <img src="./opponent-overlay.png" alt="对手已出牌悬浮窗实际界面" loading="lazy" />
          </figure>
        </div>
      </section>

      <section className="arena-section" id="arena">
        <div className="section arena-inner">
          <div className="story-copy">
            <span className="section-number">03</span>
            <h2>竞技场三选一，<br />四项依据摆在一起。</h2>
            <p>按照游戏中的左、中、右顺序显示候选牌。抽到影响、对套牌影响、选取率和高胜选取率并排呈现，帮助你自己做决定。</p>
          </div>
          <div className="arena-demo" aria-label="竞技场选牌指标示意">
            {[
              { Icon: Sparkles, title: "抽到影响", copy: "评估抽到这张牌时的胜率变化" },
              { Icon: ShieldCheck, title: "对套牌影响", copy: "评估加入套牌后的整体胜率变化" },
              { Icon: Target, title: "选取率", copy: "查看同分段玩家的平均选择比例" },
              { Icon: Check, title: "高胜选取率", copy: "参考高胜玩家在该分段的选择" },
            ].map(({ Icon, title, copy }) => (
              <div className="arena-metric" key={title}>
                <Icon aria-hidden="true" />
                <strong>{title}</strong>
                <span>{copy}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function PrivacyAndInstall() {
  const truths = [
    [ShieldCheck, "只读炉石日志", "主要读取本机日志，不修改游戏内容。"],
    [Monitor, "识别只在本机", "授权后的画面识别不会离开你的 Mac。"],
    [X, "不读取游戏内存", "不访问、不注入，也不分析炉石进程内存。"],
    [Github, "对局数据不上云", "记录与缓存保存在本机，由你掌握。"],
  ] as const;

  return (
    <>
      <section className="privacy" id="privacy">
        <div className="privacy-inner">
          <h2>只记录对局，不碰你的游戏。</h2>
          <div className="truth-grid">
            {truths.map(([Icon, title, copy]) => (
              <div className="truth" key={title}><Icon /><h3>{title}</h3><p>{copy}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section install" id="install">
        <div className="section-head centered"><h2>三步开始记牌</h2><p>安装完成后，只需做一次日志设置。</p></div>
        <ol className="steps">
          <li><span>1</span><Download /><div><h3>下载公开版</h3><p>获取 Apple 芯片安装包。</p></div></li>
          <li><span>2</span><Sparkles /><div><h3>拖入应用程序</h3><p>解压后移到“应用程序”。</p></div></li>
          <li><span>3</span><Target /><div><h3>修复日志并重启炉石</h3><p>首次点一次“修复日志”即可。</p></div></li>
        </ol>
      </section>

      <section className="download-finale">
        <div className="finale-inner">
          <h2>下一局，开始看清每张牌。</h2>
          <a className="button button-light" href={releaseUrl} target="_blank" rel="noreferrer"><Download /> 下载公开版 v0.6.7</a>
          <p className="finale-meta">macOS 12+ · Apple 芯片 · 约 117 MB</p>
          <p className="signing-note">当前安装包使用 Developer ID 正式签名，已通过 Apple 公证并装订票据。</p>
        </div>
      </section>
    </>
  );
}

function Footer() {
  return (
    <footer>
      <div className="footer-top">
        <Brand />
        <div className="footer-links">
          <a href={changelogUrl} target="_blank" rel="noreferrer">更新记录</a>
          <a href="https://github.com/jackotom/lscs-mac-jpq" target="_blank" rel="noreferrer">GitHub</a>
          <a href="mailto:admin@acyg.me">商业授权</a>
        </div>
      </div>
      <p>非暴雪娱乐或网易官方产品。炉石传说名称、卡牌图片及其他相关资产权利归各自权利人所有。</p>
      <p>源码可见，非商业许可。商业使用需事先取得书面授权。</p>
    </footer>
  );
}

export function App() {
  return <><Header /><main><Hero /><Overview /><FeatureStories /><PrivacyAndInstall /></main><Footer /></>;
}
