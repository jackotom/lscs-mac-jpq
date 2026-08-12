import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "../src/renderer/App";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function renderRoute(query: string) {
  window.history.replaceState({}, "", `/?${query}&qa-opponent-demo=1`);
  return render(<App />);
}

describe("independent overlay renderer routes", () => {
  it("renders only the friendly attack counter for its dedicated query", () => {
    const { container } = renderRoute("friendly-attack-overlay=1");

    expect(container.querySelector(".single-attack-overlay")).toBeInTheDocument();
    expect(screen.getByLabelText("我方场攻 7")).toBeInTheDocument();
    expect(screen.queryByLabelText(/对方场攻/)).not.toBeInTheDocument();
    expect(container.querySelector(".secret-overlay, .smart-counter-overlay")).not.toBeInTheDocument();
  });

  it("renders only the opponent attack counter for its dedicated query", () => {
    const { container } = renderRoute("opponent-attack-overlay=1");

    expect(container.querySelector(".single-attack-overlay")).toBeInTheDocument();
    expect(screen.getByLabelText("对手场攻 12")).toBeInTheDocument();
    expect(screen.queryByLabelText(/我方场攻/)).not.toBeInTheDocument();
    expect(container.querySelector(".secret-overlay, .smart-counter-overlay")).not.toBeInTheDocument();
  });

  it("renders the compact secret window only for the secret query", () => {
    const { container } = renderRoute("secret-overlay=1");

    expect(container.querySelector(".secret-overlay")).toBeInTheDocument();
    expect(container.querySelector(".secret-overlay-body")).toBeInTheDocument();
    expect(screen.getByText("法术反制")).toBeInTheDocument();
    const candidates = Array.from(container.querySelectorAll(".secret-overlay-candidates > li"));
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const artwork = candidate.querySelector(".secret-overlay-art");
      const image = artwork?.querySelector("img");
      const fallback = artwork?.querySelector(".secret-overlay-art-fallback");

      expect(artwork).toBeInTheDocument();
      expect(Boolean(image) || Boolean(fallback)).toBe(true);
      if (image) expect(image.getAttribute("src")?.trim()).toBeTruthy();
    }
    expect(container.querySelector(".single-attack-overlay, .smart-counter-overlay, .opponent-overlay-shell"))
      .not.toBeInTheDocument();
  });

  it("provides a dense secret demo that exceeds the compact viewport", () => {
    const { container } = renderRoute("secret-overlay=1&qa-secret-dense=1");

    const candidates = container.querySelectorAll(".secret-overlay-candidates > li");
    expect(candidates).toHaveLength(10);
    expect(screen.getByText("绿洲盟军")).toBeInTheDocument();
  });

  it("renders the smart-card counters only for the smart-counter query", () => {
    const { container } = renderRoute("smart-counter-overlay=1");

    expect(container.querySelector(".smart-counter-overlay")).toBeInTheDocument();
    expect(container.querySelectorAll(".smart-counter-item").length).toBeGreaterThan(0);
    expect(container.querySelector(".single-attack-overlay, .secret-overlay, .opponent-overlay-shell"))
      .not.toBeInTheDocument();
  });

  it("renders exactly one requested smart counter for smart-counter-id", () => {
    const { container } = renderRoute(
      "smart-counter-overlay=1&smart-counter-id=qa-opponent-void-souls"
    );

    expect(container.querySelectorAll(".smart-counter-item")).toHaveLength(1);
    expect(screen.getByLabelText("对手虚空灵魂 4")).toBeInTheDocument();
    expect(screen.queryByLabelText(/已使用龙牌/)).not.toBeInTheDocument();
  });

  it("does not duplicate secret candidates inside the regular opponent tracker", () => {
    const { container } = renderRoute("opponent-overlay=1");

    expect(screen.getByRole("region", { name: "对手记牌器置顶小窗" })).toBeInTheDocument();
    expect(container.querySelector(".secret-overlay")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /奥秘 \d+ 候选/ })).not.toBeInTheDocument();
    expect(screen.queryByText("法术反制")).not.toBeInTheDocument();
  });
});
