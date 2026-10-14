// @vitest-environment jsdom
/** Never crash (0018): one widget failing doesn't take down the others or the page. */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "@/ui/workspace/Workspace";
import { initialWorkspace } from "@/ui/workspace/layout";
import type { WidgetDef } from "@/ui/workspace/types";
import { renderWithIntl } from "../support/intl";
import { kitchen } from "../support/kitchen-rows";

afterEach(cleanup);

let shouldThrow = true;
function Broken(): never | React.ReactElement {
  if (shouldThrow) throw new Error("render failed");
  return <p>{"recovered"}</p>;
}
const Fine = () => <p>{"still here"}</p>;
const def = (id: string, titleKey: string, Component: WidgetDef["Component"]): WidgetDef => ({
  id,
  domain: "test",
  lifetime: "lasting",
  titleKey,
  isPresent: () => true,
  wantsFocus: () => false,
  Component,
});

describe("per-widget error boundary", () => {
  it("shows 'Couldn't load this · Retry' in the broken widget only; Retry recovers it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRetry = vi.fn();
    renderWithIntl(
      <Workspace
        registry={[def("a", "kitchen.title", Broken), def("b", "chat.label", Fine)]}
        state={initialWorkspace}
        dispatch={() => {}}
        data={kitchen([])}
        layout="desktop"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Couldn't load this.")).toBeInTheDocument();
    expect(screen.getByText("still here")).toBeInTheDocument();
    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByText("recovered")).toBeInTheDocument();
    error.mockRestore();
  });

  it("widget headers are buttons with an expanded state inside a named region", () => {
    renderWithIntl(
      <Workspace registry={[def("b", "kitchen.title", Fine)]} state={initialWorkspace} dispatch={() => {}} data={null} layout="phone" onRetry={() => {}} />,
    );
    const region = screen.getByRole("region", { name: "Kitchen" });
    expect(region).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kitchen/ })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("closing a session widget (Meal ideas, 0013)", () => {
  it("only session widgets get a named × that closes them; lasting ones don't", async () => {
    const dispatch = vi.fn();
    const session: WidgetDef = { ...def("ideas", "meals.ideas.title", Fine), lifetime: "session" };
    renderWithIntl(
      <Workspace registry={[def("k", "kitchen.title", Fine), session]} state={initialWorkspace} dispatch={dispatch} data={kitchen([])} layout="desktop" onRetry={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Close Kitchen" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close Meal ideas" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "userClosed", id: "ideas" });
  });
});
