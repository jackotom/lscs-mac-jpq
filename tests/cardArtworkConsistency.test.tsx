import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeckPanel } from "../src/renderer/components/DeckPanel";
import { ArenaPanel } from "../src/renderer/components/ArenaPanel";
import { OpponentPanel } from "../src/renderer/components/OpponentPanel";
import { CardDetailBody } from "../src/renderer/components/CardDetailBody";
import { toCardTrackingView } from "../src/renderer/cardTrackingView";
import { toOverlayPanelViewModel } from "../src/renderer/overlayView";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

const details = { dbfId: 1, cardId: "TEST_ART", name: "当前卡图", isSpell: false, relatedCards: [],
  imageUrl: "https://example.test/current.png", cropImageUrl: "https://example.test/old.jpg" };
const deckCard = { id: "one", name: details.name, cardType: "随从", copiesTotal: 1, copiesRemaining: 1, drawn: 0, details };
const choice = { name: details.name, cardId: details.cardId, count: 1, details };

describe("card artwork consistency across surfaces", () => {
  it("uses the same current artwork in deck, opponent, arena, pending picks and related cards", () => {
    const view = render(<>
      <DeckPanel summary={{ deckName: "牌库", totalCards: 1, remainingCards: 1 }} cards={[deckCard]} />
      <OpponentPanel overview={{ heroClass: "未知", lastAction: "无" }} playedCards={[{ id: "opponent", hidden: false, name: details.name, count: 1, details }]} />
      <ArenaPanel state={{ status: "redrafting", draftCount: 1, unresolvedCount: 29, currentChoices: [choice], deck: [choice], pendingRedraftChoices: [choice], picks: [] }} />
      <CardDetailBody mode="interactive" details={{ ...details, relatedCards: [details] }} />
    </>);
    const thumbnails = view.container.querySelectorAll('.card-thumb, .card-related-art img');
    expect(thumbnails).toHaveLength(6);
    for (const img of thumbnails) expect(img).toHaveAttribute('src', details.imageUrl);
  });

  it("falls back on failure and retries the current source after artwork changes", () => {
    const view = render(<DeckPanel summary={{ deckName: "牌库", totalCards: 1, remainingCards: 1 }} cards={[deckCard]} />);
    const thumbnail = () => view.container.querySelector('.card-thumb')!;
    expect(thumbnail()).toHaveAttribute('src', details.imageUrl);
    fireEvent.error(thumbnail());
    expect(thumbnail()).toHaveAttribute('src', details.cropImageUrl);
    view.rerender(<DeckPanel summary={{ deckName: "牌库", totalCards: 1, remainingCards: 1 }} cards={[{ ...deckCard, details: { ...details, imageUrl: "https://example.test/new.png" } }]} />);
    expect(thumbnail()).toHaveAttribute('src', 'https://example.test/new.png');
    view.rerender(<DeckPanel summary={{ deckName: "牌库", totalCards: 1, remainingCards: 1 }} cards={[deckCard]} />);
    expect(thumbnail()).toHaveAttribute('src', details.imageUrl);
  });

  it("projects current artwork for lifecycle and arena overlays", () => {
    const state = createPublicTrackerState();
    const tracking = { ...state.cardTracking,
      detailsByCardKey: { 'id:test_art': details },
      friendly: { ...state.cardTracking.friendly, current: { ...state.cardTracking.friendly.current,
        deck: { status: 'known' as const, knownCount: 1, totalCount: 1, cards: [{ cardKey: 'id:test_art', cardId: details.cardId, name: details.name, count: 1 }] } } } };
    expect(toCardTrackingView(tracking, 'friendly', { showSecretCandidates: true }).current.deck.cards[0].thumbnailUrl).toBe(details.imageUrl);
    const overlay = toOverlayPanelViewModel({ ...state, trackerMode: 'arena', cardTracking: tracking,
      arena: { status: 'drafting', draftCount: 1, unresolvedCount: 29, currentChoices: [choice, { ...choice, cardId: 'SECOND' }, { ...choice, cardId: 'THIRD' }], deck: [choice], picks: [] } });
    expect(overlay.arena?.choices[0].thumbnailUrl).toBe(details.imageUrl);
    expect(overlay.arena?.deck[0].thumbnailUrl).toBe(details.imageUrl);
  });
});
