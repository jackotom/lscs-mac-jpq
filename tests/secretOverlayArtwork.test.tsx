import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretOverlay } from "../src/renderer/components/SecretOverlay";

afterEach(() => cleanup());

describe("SecretOverlay candidate artwork", () => {
  it("matches the compact single-slot secret helper structure", () => {
    const { container } = render(
      <SecretOverlay
        slots={[{
          id: "secret-1",
          label: "奥秘 1",
          candidates: [
            {
              id: "EX1_287",
              name: "法术反制",
              status: "possible",
              details: {
                dbfId: 287,
                cardId: "EX1_287",
                name: "法术反制",
                manaCost: 3,
                rarity: "RARE",
                isSpell: true,
                relatedCards: []
              }
            },
            { id: "EX1_289", name: "寒冰护体", status: "possible" },
            { id: "EX1_294", name: "镜像实体", status: "excluded" }
          ]
        }]}
      />
    );

    expect(screen.getByText("奥秘助手")).toBeInTheDocument();
    expect(screen.getByLabelText("未知奥秘")).toHaveTextContent("?");
    expect(screen.queryByText(/奥秘 1/)).not.toBeInTheDocument();
    expect(screen.getByText("3")).toHaveClass("secret-overlay-cost", "secret-overlay-cost--rare");
    expect(screen.getByText("法术反制")).toHaveClass("secret-overlay-name");
    expect(container.querySelectorAll(".secret-overlay-candidates > li")).toHaveLength(2);
  });

  it("uses the reference window's single-column 124-by-17 visual rhythm", () => {
    const css = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/secretOverlayStyles.css"),
      "utf8"
    );

    expect(css).toMatch(/\.secret-overlay-badge\s*\{[^}]*width:\s*22px[^}]*height:\s*22px[^}]*border-radius:\s*50%/su);
    expect(css).toMatch(/\.secret-overlay\s*\{[^}]*width:\s*calc\(100%\s*-\s*20px\)[^}]*grid-template-rows:\s*18px\s+minmax\(0,\s*1fr\)[^}]*border-radius:\s*0/su);
    expect(css).toMatch(/\.secret-overlay-candidates\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*gap:\s*0/su);
    expect(css).toMatch(/\.secret-overlay-candidates\s*>\s*li[\s\S]*?height:\s*17px[\s\S]*?grid-template-columns:\s*18px\s+minmax\(0,\s*1fr\)/su);
    expect(css).toMatch(/\.secret-overlay-art\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/su);
    expect(css).toMatch(/\.secret-overlay-body\s*\{[^}]*overflow-y:\s*hidden/su);
  });

  it("falls back visibly after every card artwork source fails", () => {
    const { container } = render(
      <SecretOverlay
        slots={[{
          id: "secret-1",
          label: "奥秘 1",
          candidates: [{ id: "EX1_287", name: "法术反制", status: "possible" }]
        }]}
      />
    );

    const artwork = container.querySelector(".secret-overlay-art");
    expect(artwork).toBeInTheDocument();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const image = artwork?.querySelector("img");
      if (!image) break;
      expect(image.getAttribute("src")?.trim()).toBeTruthy();
      fireEvent.error(image);
    }

    expect(artwork?.querySelector("img")).not.toBeInTheDocument();
    expect(artwork?.querySelector(".secret-overlay-art-fallback")).toBeInTheDocument();
    expect(screen.getByLabelText("法术反制卡图暂不可用")).toBeInTheDocument();
  });
});
