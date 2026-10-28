import { ChevronLeft, ChevronRight, Database, ImageOff, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cardArtworkSources, type CardDetails } from "../../shared/cardDatabase";
import type { DataSourceProvenance } from "../../shared/dataSourceProvenance";
import "../cardLibraryStyles.css";
import { CardDetailBody } from "./CardDetailBody";
import { CardHoverPreview } from "./CardHoverPreview";

export interface CardLibraryFilters {
  readonly heroClass: string;
  readonly cardType: string;
  readonly heroClasses: readonly string[];
  readonly cardTypes: readonly string[];
}

export interface CardLibraryPage {
  readonly current: number;
  readonly totalPages: number;
}

export type CardLibraryCard = CardDetails;

export interface CardLibraryPanelProps {
  readonly cards: readonly CardLibraryCard[];
  readonly total: number;
  readonly filters: CardLibraryFilters;
  readonly query: string;
  readonly loading: boolean;
  readonly error?: string;
  readonly sources?: readonly DataSourceProvenance[];
  readonly page: CardLibraryPage;
  readonly onSearch: (query: string) => void;
  readonly onClassChange: (className: string) => void;
  readonly onTypeChange: (type: string) => void;
  readonly onPageChange: (page: number) => void;
  readonly onSelectCard: (card: CardLibraryCard) => void;
}

export function CardLibraryPanel({
  cards,
  total,
  filters,
  query,
  loading,
  error,
  sources = [],
  page,
  onSearch,
  onClassChange,
  onTypeChange,
  onPageChange,
  onSelectCard
}: CardLibraryPanelProps) {
  const [selectedCardId, setSelectedCardId] = useState<number>();
  const selectedCard = cards.find((card) => card.dbfId === selectedCardId);
  const currentPage = Math.max(1, page.current);
  const totalPages = Math.max(1, page.totalPages);

  function selectCard(card: CardLibraryCard) {
    setSelectedCardId(card.dbfId);
    onSelectCard(card);
  }

  return (
    <section className="card-library-panel" aria-label="卡牌数据库" aria-busy={loading}>
      <header className="card-library-heading">
        <div className="card-library-heading-copy">
          <Database aria-hidden="true" size={18} />
          <div>
            <h2>卡牌数据库</h2>
            <p>内置炉石卡牌资料</p>
          </div>
        </div>
        <strong className="card-library-total" aria-label={`共 ${total.toLocaleString("zh-CN")} 张卡牌`}>
          {total.toLocaleString("zh-CN")}
        </strong>
      </header>

      <div className="card-library-controls">
        <label className="card-library-search">
          <Search aria-hidden="true" size={16} />
          <span className="sr-only">搜索卡牌</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="搜索卡牌名称或效果"
            aria-label="搜索卡牌"
          />
        </label>

        <label className="card-library-select">
          <span>职业</span>
          <select
            value={filters.heroClass}
            onChange={(event) => onClassChange(event.target.value)}
            aria-label="职业筛选"
            disabled={loading}
          >
            <option value="">全部职业</option>
            {filters.heroClasses.map((heroClass) => (
              <option key={heroClass} value={heroClass}>
                {heroClass}
              </option>
            ))}
          </select>
        </label>

        <label className="card-library-select">
          <span>类型</span>
          <select
            value={filters.cardType}
            onChange={(event) => onTypeChange(event.target.value)}
            aria-label="类型筛选"
            disabled={loading}
          >
            <option value="">全部类型</option>
            {filters.cardTypes.map((cardType) => (
              <option key={cardType} value={cardType}>
                {cardType}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card-library-results-bar" aria-live="polite">
        <span>{loading ? "正在读取卡牌资料" : `找到 ${total.toLocaleString("zh-CN")} 张卡牌`}</span>
        <span>{query.trim() ? `关键词：${query.trim()}` : "悬停查看完整效果"}</span>
      </div>

      {sources.length > 0 ? <details className="card-library-sources">
        <summary>数据来源</summary>
        <ul>
          {sources.map((source) => <li key={source.id}>
            <strong>{source.label}</strong>
            <span className={`card-library-source-status is-${source.authorization.status}`}>{authorizationLabel(source.authorization.status)}</span>
            <p>{source.authorization.note}</p>
            {source.urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" onClick={(event) => {
              const open = window.hearthstoneTracker?.openDataSourceUrl;
              if (!open) return;
              event.preventDefault();
              void open(url);
            }}>官网链接</a>)}
          </li>)}
        </ul>
      </details> : null}

      <div className="card-library-results">
        {loading && cards.length === 0 ? <LoadingState /> : error && cards.length === 0 ? <ErrorState error={error} /> : cards.length === 0 ? <EmptyState /> : (
          <>
            {error ? <StaleResultsWarning error={error} /> : null}
            <div className="card-library-grid" aria-label="卡牌搜索结果">
              {cards.map((card) => (
                <CardLibraryTile
                  card={card}
                  key={card.dbfId}
                  selected={card.dbfId === selectedCardId}
                  onSelect={selectCard}
                />
              ))}
            </div>

            {selectedCard ? (
              <section className="card-library-selected" aria-label={`已选卡牌：${selectedCard.name}`}>
                <div className="card-library-selected-heading">
                  <span>卡牌详情</span>
                  <strong>{selectedCard.name}</strong>
                </div>
                <CardDetailBody details={selectedCard} className="card-library-detail-body" mode="interactive" />
              </section>
            ) : null}
          </>
        )}
      </div>

      <footer className="card-library-pagination" aria-label="卡牌数据库分页">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={loading || currentPage <= 1}
          aria-label="上一页"
          title="上一页"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </button>
        <span>
          第 {currentPage} / {totalPages} 页
        </span>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={loading || currentPage >= totalPages}
          aria-label="下一页"
          title="下一页"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </section>
  );
}

function authorizationLabel(status: DataSourceProvenance["authorization"]["status"]): string {
  return status === "authorized" ? "已获当前用途授权" : status === "pending-confirmation" ? "授权待确认" : "授权状态未知";
}

function CardLibraryTile({
  card,
  selected,
  onSelect
}: {
  card: CardLibraryCard;
  selected: boolean;
  onSelect: (card: CardLibraryCard) => void;
}) {
  const typeLabel = [card.heroClass, card.cardType ?? (card.isSpell ? "法术" : undefined)].filter(Boolean).join(" · ");
  const stats = !card.isSpell && card.attack !== undefined && card.health !== undefined
    ? `${card.attack} / ${card.health}`
    : undefined;

  return (
    <CardHoverPreview details={card} className="card-library-hover-target">
      <button
        type="button"
        className={`card-library-card${selected ? " is-selected" : ""}`}
        onClick={() => onSelect(card)}
        aria-pressed={selected}
        aria-label={`查看 ${card.name} 详情`}
      >
        <CardArtwork card={card} />
        <span className="card-library-mana" aria-label={`${card.manaCost ?? 0} 费`}>
          {card.manaCost ?? "—"}
        </span>
        {stats ? <span className="card-library-stats" aria-label={`攻击 ${card.attack}，生命 ${card.health}`}>{stats}</span> : null}
        <span className="card-library-card-copy">
          <strong title={card.name}>{card.name}</strong>
          <small title={typeLabel}>{typeLabel || "卡牌"}</small>
        </span>
      </button>
    </CardHoverPreview>
  );
}

function CardArtwork({ card }: { card: CardLibraryCard }) {
  // The official full image is current while some official crop assets lag behind it.
  const sources = cardArtworkSources(card, "image-first");
  const sourcesKey = sources.join("\n");
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  const isUnavailable = !source;
  useEffect(() => setSourceIndex(0), [sourcesKey]);

  return (
    <span className={`card-library-art${isUnavailable ? " is-empty" : ""}`} aria-label={isUnavailable ? "卡图不可用" : undefined}>
      {!isUnavailable && source ? (
        <img src={source} alt="" loading="lazy" onError={() => setSourceIndex((index) => index + 1)} />
      ) : (
        <ImageOff aria-hidden="true" size={18} />
      )}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="card-library-state" role="status">
      <Database aria-hidden="true" size={20} />
      <strong>正在读取卡牌数据库</strong>
      <span>首次加载本地卡牌资料可能需要几秒。</span>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="card-library-state is-error" role="alert">
      <Database aria-hidden="true" size={20} />
      <strong>卡牌数据库读取失败</strong>
      <span>{error}</span>
    </div>
  );
}

function StaleResultsWarning({ error }: { error: string }) {
  return (
    <div className="card-library-stale-warning" role="alert">
      <Database aria-hidden="true" size={16} />
      <span>刷新失败，已保留上次结果：{error}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card-library-state" role="status">
      <Search aria-hidden="true" size={20} />
      <strong>没有匹配的卡牌</strong>
      <span>换一个名称、职业或类型再试。</span>
    </div>
  );
}
