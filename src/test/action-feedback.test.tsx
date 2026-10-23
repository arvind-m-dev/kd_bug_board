import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmAction, actionError } from "@/components/bugflow/action-feedback";

afterEach(cleanup);
describe("Sign-out confirmation", () => {
  it("does not sign out before confirmation or when cancelled", () => {
    const signOut = vi.fn(async () => {});
    const close = vi.fn();
    render(
      <ConfirmAction
        open
        onOpenChange={close}
        title="Sign out?"
        description="Unsaved changes will be lost."
        confirmLabel="Sign out"
        onConfirm={signOut}
      />,
    );
    expect(signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledWith(false);
    expect(signOut).not.toHaveBeenCalled();
  });
  it("signs out only after confirmation", async () => {
    const signOut = vi.fn(async () => {});
    const close = vi.fn();
    render(
      <ConfirmAction
        open
        onOpenChange={close}
        title="Sign out?"
        description="Unsaved changes will be lost."
        confirmLabel="Sign out"
        onConfirm={signOut}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
  it("keeps failed actions open for retry", async () => {
    const close = vi.fn();
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network failure"))
      .mockResolvedValueOnce(undefined);
    render(
      <ConfirmAction
        open
        onOpenChange={close}
        title="Sign out?"
        description="Unsaved changes will be lost."
        confirmLabel="Sign out"
        onConfirm={action}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("alert");
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(action).toHaveBeenCalledTimes(2);
  });
});
describe("Safe action errors", () => {
  it("does not reveal database or network internals", () => {
    expect(actionError(new Error("Postgres SQL connection failed"), "Try again.")).toBe(
      "Try again.",
    );
  });
});
