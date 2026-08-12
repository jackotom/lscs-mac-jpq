import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretOverlay } from "../src/renderer/components/SecretOverlay";

afterEach(() => cleanup());

describe("SecretOverlay candidate artwork", () => {
  it("keeps the secret slot identity and possible-candidate count visible", () => {
    render(
      <SecretOverlay
        slots={[{
          id: "secret-1",
          label: "奥秘 1",
          candidates: [
            { id: "EX1_287", name: "法术反制", status: "possible" },
            { id: "EX1_289", name: "寒冰护体", status: "possible" },
            { id: "EX1_294", name: "镜像实体", status: "excluded" }
          ]
        }]}
      />
    );

    expect(screen.getByText("奥秘 1 · 2 种")).toBeInTheDocument();
  });

  it("keeps slot labels sticky and dense candidates readable", () => {
    const css = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/secretOverlayStyles.css"),
      "utf8"
    );

    expect(css).toMatch(/\.secret-overlay-slot\s*>\s*:first-child\s*\{[^}]*position:\s*sticky[^}]*top:\s*4px/su);
    expect(css).toMatch(/\.secret-overlay-candidates\s*>\s*li[\s\S]*?font-size:\s*10\.5px/su);
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
