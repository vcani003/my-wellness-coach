// @vitest-environment jsdom
/**
 * Arrivals ease in (0059 PF16, src/ui/primitives/Appear.tsx): only what mounts AFTER its scope
 * opened carries `data-appear`, once; what was there when the scope opened, or sits outside any
 * scope, never animates. The content is in the page either way (nothing waits for an animation).
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Appear, AppearScope } from "@/ui/primitives/Appear";

/** An entrance ending (jsdom has no AnimationEvent, so React may listen for the prefixed name). */
function animationEnd(el: Element) {
  for (const type of ["animationend", "webkitAnimationEnd"]) {
    act(() => {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }
}

function List({ items }: { items: string[] }) {
  return (
    <AppearScope>
      {items.map((t) => (
        <Appear key={t} kind="grow" as="p">
          {t}
        </Appear>
      ))}
    </AppearScope>
  );
}

describe("Appear", () => {
  afterEach(cleanup);

  it("leaves what was there when the scope opened alone", () => {
    render(<List items={["eggs", "milk"]} />);
    expect(screen.getByText("eggs")).not.toHaveAttribute("data-appear");
    expect(screen.getByText("milk")).not.toHaveAttribute("data-appear");
  });

  it("eases in what arrives later, once", () => {
    const { rerender } = render(<List items={["eggs"]} />);
    rerender(<List items={["eggs", "rice"]} />);
    const rice = screen.getByText("rice");
    expect(rice).toHaveAttribute("data-appear", "grow");
    expect(screen.getByText("eggs")).not.toHaveAttribute("data-appear");
    // A child's own animation (Lumi's hop) bubbling up doesn't end it…
    const child = document.createElement("span");
    rice.appendChild(child);
    animationEnd(child);
    expect(rice).toHaveAttribute("data-appear", "grow");
    // …its own entrance does, and then it never replays.
    animationEnd(rice);
    expect(rice).not.toHaveAttribute("data-appear");
    rerender(<List items={["eggs", "rice", "tea"]} />);
    expect(screen.getByText("rice")).not.toHaveAttribute("data-appear");
    expect(screen.getByText("tea")).toHaveAttribute("data-appear", "grow");
  });

  it("never animates outside a scope", () => {
    const { rerender } = render(<div />);
    rerender(
      <div>
        <Appear>late</Appear>
      </div>,
    );
    expect(screen.getByText("late")).not.toHaveAttribute("data-appear");
  });
});
