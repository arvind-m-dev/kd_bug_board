import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeasonalGifts } from "@/components/bugflow/seasonal-gifts";

afterEach(cleanup);
describe("Santa gifts", () => {
  it("opens an accessible tip without activating the underlying UI, and removes the gift", () => {
    const host = createRef<HTMLDivElement>();
    host.current = document.createElement("div");
    render(<SeasonalGifts host={host} />);
    act(() => {
      host.current!.dispatchEvent(new CustomEvent("seasonal-gift", { detail: { x: 200, y: 300 } }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Santa’s debugging gift" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Santa’s debugging gift" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("bounds gift count and clears fixed gifts when the page scrolls", () => {
    const host = createRef<HTMLDivElement>();
    host.current = document.createElement("div");
    render(<SeasonalGifts host={host} />);
    act(() => {
      for (let i = 0; i < 8; i++)
        host.current!.dispatchEvent(
          new CustomEvent("seasonal-gift", { detail: { x: 50 + i * 50, y: 200 } }),
        );
    });
    expect(screen.getAllByRole("button")).toHaveLength(4);
    fireEvent.scroll(window);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
