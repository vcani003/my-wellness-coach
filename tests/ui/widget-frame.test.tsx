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
