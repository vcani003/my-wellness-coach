// @vitest-environment jsdom
/**
 * Lumi, the assistant's cat (KOS10, 0045; bright line-drawn cat, 0048): states, decorative by
 * default, cat colour tokens only, and no looping animation (0046).
 */
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Lumi, LumiHalo, type LumiState } from "@/ui/lumi/Lumi";

afterEach(cleanup);
// jsdom changes import.meta.url resolution, so resolve from the repo root (vitest runs there).
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** The `.lumi-cat` rules in globals.css (from the first one to the end of its reduced-motion block). */
const lumiCss = css.slice(css.indexOf(".lumi-cat {"), css.indexOf(".lumi-halo {"));

describe("Lumi", () => {
  it("is decorative unless given a translated title", () => {
    const { container } = render(<Lumi state="think" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-state", "think");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("becomes a named image with a title", () => {
    render(<Lumi state="sleep" title="Lumi is resting" />);
    expect(screen.getByRole("img", { name: "Lumi is resting" })).toHaveAttribute("data-state", "sleep");
  });

  it.each<LumiState>(["idle", "think", "happy", "sleep"])("draws %s with the cat colour tokens only", (state) => {
    const { container } = render(<Lumi state={state} />);
    const colours = [...container.querySelectorAll("[fill], [stroke]")].flatMap((el) =>
      ["fill", "stroke"].map((a) => el.getAttribute(a)).filter((v): v is string => Boolean(v) && v !== "none"),
    );
    expect(colours.length).toBeGreaterThan(5);
    for (const c of colours) expect(c).toMatch(/^var\(--cat-[a-z]+\)$/);
    // Both eye sets are drawn; CSS picks which shows for the state.
    expect(container.querySelector(".lumi-eyes")).not.toBeNull();
    expect(container.querySelector(".lumi-happy-eyes")).not.toBeNull();
  });

  it("defines every cat colour it uses", () => {
    for (const name of ["line", "fur", "ear", "blush", "brow"]) expect(css).toMatch(new RegExp(`--cat-${name}:\\s*#[0-9a-f]{6};`));
  });

  it("never loops (0046): no infinite animation, no blink, no tail, and nothing moves with reduced motion", () => {
    expect(lumiCss).not.toBe("");
    expect(lumiCss).not.toMatch(/infinite|alternate/);
    expect(lumiCss).not.toMatch(/blink|wag|\.tail/);
    expect(lumiCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.lumi-cat \.lumi-head \{\s*animation: none;/);
  });

  it("sits in a decorative halo", () => {
    const { container } = render(<LumiHalo state="happy" size="lumi-lg" />);
    const halo = container.firstElementChild!;
    expect(halo).toHaveAttribute("aria-hidden", "true");
    expect(halo).toHaveClass("lumi-halo", "size-lumi-lg");
    expect(halo.querySelector("svg")).toHaveAttribute("data-state", "happy");
  });

  it("ships no cream illustrations any more (0048)", () => {
    for (const dir of ["art/lumi", "art/food", "art/icons"]) expect(existsSync(join(process.cwd(), "public", dir))).toBe(false);
  });
});
