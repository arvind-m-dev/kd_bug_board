import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SurfaceEffects } from "@/components/bugflow/surface-effects";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("isolates decorative actors while table selection and original text stay intact", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const { container, unmount } = render(
    <>
      <h1>All bugs</h1>
      <table>
        <tbody>
          <tr>
            <td>
              <input type="checkbox" aria-label="Select bug" />
            </td>
            <td>Original report</td>
          </tr>
        </tbody>
      </table>
      <SurfaceEffects season="halloween" />
    </>,
  );
  const layer = container.querySelector(".bf-surface-effects")!;
  expect(layer.getAttribute("aria-hidden")).toBe("true");
  expect(layer.hasAttribute("inert")).toBe(true);
  expect(layer.querySelectorAll(".bf-surface-bug")).toHaveLength(3);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select bug" }));
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(screen.getByText("Original report")).toBeVisible();
  expect(screen.getByRole("heading")).toHaveTextContent("All bugs");
  unmount();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  expect(layer.childElementCount).toBe(0);
});
it("does not move actors when reduced motion is requested", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  let tick: FrameRequestCallback = () => {};
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback) => {
      tick = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const { container } = render(<SurfaceEffects season="halloween" />);
  tick(1000);
  expect((container.firstChild as HTMLElement).style.visibility).toBe("hidden");
  expect((container.querySelector(".bf-surface-bug") as HTMLElement).style.transform).toBe("");
});
