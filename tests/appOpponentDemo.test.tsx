import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "../src/renderer/App";

describe("opponent overlay QA demo", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("renders representative opponent data only for the explicit QA route", () => {
    window.history.replaceState({}, "", "/?opponent-overlay=1&qa-opponent-demo=1");

    render(<App />);

    expect(screen.queryByRole("region", { name: /奥秘 \d+ 候选/ })).not.toBeInTheDocument();
    expect(screen.queryByText("法术反制")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "对方公开计数" })).toBeInTheDocument();
    expect(screen.getByLabelText("对方下次疲劳伤害 3")).toBeInTheDocument();
    expect(screen.getByLabelText("对方尸体 4")).toBeInTheDocument();
    expect(screen.getByLabelText("对方已用法术 5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(screen.getByRole("button", { name: /已使用 \(1\)/ }));
    expect(screen.getByText("伺机待发")).toBeInTheDocument();
  });

  it("renders both attack icons in the explicit board overlay QA route", () => {
    window.history.replaceState({}, "", "/?board-attack-overlay=1&qa-opponent-demo=1");

    render(<App />);

    expect(screen.getByLabelText("场攻悬浮窗")).toBeInTheDocument();
    expect(screen.getByLabelText("对方场攻 12")).toHaveStyle({ left: "25.5%", top: "22.39%" });
    expect(screen.getByLabelText("我方场攻 7")).toHaveStyle({ left: "25.5%", top: "67.62%" });
  });

  it("renders representative friendly public counters in the explicit tracker overlay QA route", () => {
    window.history.replaceState({}, "", "/?overlay=1&qa-opponent-demo=1");

    render(<App />);

    expect(screen.getByRole("region", { name: "我方公开计数" })).toBeInTheDocument();
    expect(screen.getByLabelText("我方下次疲劳伤害 2")).toBeInTheDocument();
    expect(screen.getByLabelText("我方尸体 6")).toBeInTheDocument();
    expect(screen.getByLabelText("我方已用法术 8")).toBeInTheDocument();
  });
});
