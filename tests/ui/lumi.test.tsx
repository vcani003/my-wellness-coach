// @vitest-environment jsdom
/** Lumi, the assistant's cat (KOS10, 0045): states, decorative by default, art files present. */
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LUMI_ART, Lumi } from "@/ui/lumi/Lumi";

afterEach(cleanup);
// jsdom changes import.meta.url resolution, so resolve from the repo root (vitest runs there).
const publicFile = (p: string) => join(process.cwd(), "public", p);

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

  it.each(Object.entries(LUMI_ART))("ships %s art, decorative and without hard-coded English", (_name, path) => {
    expect(existsSync(publicFile(path))).toBe(true);
    const svg = readFileSync(publicFile(path), "utf8");
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toMatch(/<title|aria-label|<script|href=/);
  });
});
