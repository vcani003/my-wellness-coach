/**
 * Smart staples eval cases (0054), scored by exact rules. Interpreter-agnostic: the same cases run
 * against the fake in the unit tests (tests/unit/staples-ai.test.ts, free) and against the real
 * model in `npm run eval` (interpret.eval.ts, real money). People are fictional (Ana, Ben).
 */
import { expect } from "vitest";
import type { Operation, OperationOf, OperationType } from "@/contracts/operations";
import { ProposedChange } from "@/contracts/proposed-change";
import type { InterpretRequest, InterpretResult } from "../interpreter";
import { request, withStaples, type ItemSpec, type ListSpec, type StapleSpec } from "./fixtures";

export interface StapleCase {
  name: string;
  text: string;
  items?: ItemSpec[];
  list?: ListSpec[];
  history?: InterpretRequest["history"];
  staples?: StapleSpec[];
  allergies?: NonNullable<InterpretRequest["allergies"]>;
  check: (r: InterpretResult, ops: Operation[]) => void;
}

export function stapleCaseRequest(c: StapleCase): InterpretRequest {
  return withStaples(request(c.text, c.items, c.history, c.list), c.staples, c.allergies);
}

export function opsOf(r: InterpretResult): Operation[] {
  return r.proposal ? ProposedChange.parse(r.proposal).operations : [];
}

const only = <T extends OperationType>(ops: Operation[], type: T) => ops.filter((o): o is OperationOf<T> => o.type === type);
const stapleAdds = (ops: Operation[]) => only(ops, "staple.add").map((o) => o.fields.name.value.toLowerCase());

/** Ana's saved staples, one in each state. */
const SAVED: StapleSpec[] = [
  { name: "fish sauce", store: "MD Oriental", need: "out" },
  { name: "jasmine rice", need: "low" },
  { name: "eggs", need: "have" },
  { name: "rice noodles", store: "MD Oriental", need: "on-list" },
  { name: "garlic", need: "missing" },
];

const OFFER = "A few basics to keep on hand: jasmine rice, eggs and garlic. Want me to remember these as your staples?";

export const STAPLE_CASES: StapleCase[] = [
  {
    name: "staples: said in her own words → saved (SS2)",
    text: "fish sauce is a staple",
    check: (r, ops) => {
      expect(r.kind).toBe("change");
      expect(stapleAdds(ops)).toEqual([expect.stringContaining("fish sauce")]);
      expect(only(ops, "shopping.add")).toHaveLength(0);
      expect(only(ops, "item.add")).toHaveLength(0);
    },
  },
  {
    name: "staples: a usual store only when said (SS5)",
    text: "we always get rice noodles at MD Oriental",
    check: (r, ops) => {
      const [add] = only(ops, "staple.add");
      expect(add.fields.name.value.toLowerCase()).toContain("rice noodle");
      expect(add.fields.store?.value).toBe("MD Oriental");
    },
  },
  {
    name: "staples: Vietnamese names kept as said",
    text: "nước mắm is a staple",
    check: (r, ops) => {
      const [add] = only(ops, "staple.add");
      expect(add.fields.name.value).toContain("nước mắm");
      expect(add.fields.store ?? null).toBeNull();
    },
  },
  {
    name: "staples: yes to Kitchen's offer saves those staples, not a preference line",
    text: "yes please",
    history: [
      { role: "user", text: "what staples do I need?" },
      { role: "assistant", text: OFFER },
    ],
    check: (r, ops) => {
      expect(stapleAdds(ops).sort()).toEqual(["eggs", "garlic", "jasmine rice"]);
      expect(only(ops, "profile.preference.save")).toHaveLength(0);
      for (const o of only(ops, "staple.add")) expect(o.evidence?.toLowerCase()).toContain("yes");
    },
  },
  {
    name: "staples: an ignored offer saves nothing",
    text: "I bought eggs",
    history: [
      { role: "user", text: "what staples do I need?" },
      { role: "assistant", text: OFFER },
    ],
    check: (r, ops) => {
      expect(only(ops, "staple.add")).toHaveLength(0);
      expect(only(ops, "profile.preference.save")).toHaveLength(0);
    },
  },
  {
    name: "staples: 'not a staple any more' removes it",
    text: "eggs aren't a staple any more",
    staples: SAVED,
    check: (r, ops) => {
      const [rm] = only(ops, "staple.remove");
      expect(rm.target).toMatchObject({ name: expect.stringMatching(/egg/i) });
      expect(only(ops, "item.remove")).toHaveLength(0);
    },
  },
  {
    name: "staples: 'what staples do I need?' is answered from the saved staples by code (SS6)",
    text: "what staples do I need?",
    staples: SAVED,
    check: (r, ops) => {
      expect(r.kind).toBe("answer");
      expect(ops).toHaveLength(0);
      expect(r.staples?.items.map((s) => s.stapleId)).toEqual(["fish sauce", "jasmine rice", "garlic"]);
      expect(r.reply).toMatch(/MD Oriental: fish sauce \(out\)/);
      expect(r.reply).toMatch(/Already on your list: rice noodles/);
      expect(r.reply).not.toMatch(/\beggs\b/);
    },
  },
  {
    name: "staples: everything stocked",
    text: "what staples do I need?",
    staples: [{ name: "eggs", need: "have" }, { name: "jasmine rice", need: "have" }],
    check: (r, ops) => {
      expect(ops).toHaveLength(0);
      expect(r.staples).toBeUndefined();
      expect(r.reply).toMatch(/all your staples are stocked/i);
    },
  },
  {
    name: "staples: none saved → a general guess that leaves out members' allergens",
    text: "what staples do I need?",
    allergies: [{ subject: "peanuts", who: "Ben" }],
    check: (r, ops) => {
      expect(r.kind).toBe("answer");
      expect(ops).toHaveLength(0);
      expect(r.staples).toBeUndefined();
      expect(r.reply).not.toMatch(/peanut/i);
    },
  },
  {
    name: "staples: running low only offers, never adds (SS4); the receipt button asks, not the reply (SS10)",
    text: "fish sauce is running low",
    items: [{ name: "fish sauce", location: "pantry" }],
    staples: [{ name: "fish sauce", store: "MD Oriental", need: "have" }],
    check: (r, ops) => {
      expect(only(ops, "item.use").length + only(ops, "item.stock.set").length).toBeGreaterThan(0);
      expect(only(ops, "shopping.add")).toHaveLength(0);
      expect(only(ops, "staple.add")).toHaveLength(0);
      expect(r.reply).not.toMatch(/add\b[^.?!]*\bto (your|the) (shopping )?list\?/i);
    },
  },
];
