/**
 * "Ask before removing more than 5 things" eval cases (0045 KOS16), scored by exact rules. The
 * interpreter must propose **every** removal (never ask on its own, never drop some); code then
 * decides whether the turn asks (`bulkConfirmFor`, the same function `turn.ts` runs). Interpreter-
 * agnostic: the cases run against the fake in tests/unit/bulk-remove.test.ts (free) and against the
 * real model in `npm run eval` (interpret.eval.ts, real money). People are fictional (Ana, Ben).
 */
import { expect } from "vitest";
import type { Operation } from "@/contracts/operations";
import { ProposedChange } from "@/contracts/proposed-change";
import { bulkConfirmFor } from "../bulk-remove";
import type { InterpretRequest, InterpretResult } from "../interpreter";
import { request, withStaples, type ItemSpec, type ListSpec, type StapleSpec } from "./fixtures";

export interface BulkRemoveCase {
  name: string;
  text: string;
  items?: ItemSpec[];
  list?: ListSpec[];
  staples?: StapleSpec[];
  /** How many things code would ask about; null = saves right away (5 or fewer removals). */
  asks: number | null;
  /** The operation types the interpreter must propose (each at least once), when it matters. */
  types?: Operation["type"][];
}

export function bulkCaseRequest(c: BulkRemoveCase): InterpretRequest {
  return withStaples(request(c.text, c.items, [], c.list), c.staples);
}

/** The interpreter's operations, then what the turn would do with them. */
export function checkBulkCase(c: BulkRemoveCase, req: InterpretRequest, r: InterpretResult): void {
  const ops = r.proposal ? ProposedChange.parse(r.proposal).operations : [];
  expect(r.kind).toBe("change");
  expect(r.proposal?.clarification).toBeUndefined();
  for (const type of c.types ?? []) expect(ops.map((o) => o.type)).toContain(type);
  const confirm = bulkConfirmFor(ops, req.state);
  if (c.asks === null) {
    expect(confirm).toBeNull();
  } else {
    expect(confirm?.count).toBe(c.asks);
    expect(confirm?.reply).toMatch(new RegExp(`^That would remove ${c.asks} things`));
  }
}

const SIX: ItemSpec[] = ["milk", "eggs", "bread", "rice", "butter", "cheese"].map((name) => ({ name, location: "fridge" }));
const SEVEN_ON_LIST: ListSpec[] = ["oat milk", "garlic", "ginger", "limes", "hoisin sauce", "rice noodles", "tofu"].map((name) => ({ name }));

export const BULK_REMOVE_CASES: BulkRemoveCase[] = [
  {
    name: "bulk remove: out of six things → every one proposed, Lumi asks first",
    text: "we're out of milk, eggs, bread, rice, butter and cheese",
    items: SIX,
    asks: 6,
    types: ["item.use"],
  },
  {
    name: "bulk remove: out of five things → saves right away",
    text: "we're out of milk, eggs, bread, rice and butter",
    items: SIX,
    asks: null,
    types: ["item.use"],
  },
  {
    name: "bulk remove: running low on six things isn't removing anything",
    text: "we're running low on milk, eggs, bread, rice, butter and cheese",
    items: SIX,
    asks: null,
    types: ["item.use"],
  },
  {
    name: "bulk remove: throwing out seven things asks",
    text: "throw out the milk, eggs, bread, rice, butter, cheese and yogurt",
    items: [...SIX, { name: "yogurt", location: "fridge" }],
    asks: 7,
    types: ["item.remove"],
  },
  {
    name: "bulk remove: clearing a 7-item list asks",
    text: "clear the list",
    list: SEVEN_ON_LIST,
    asks: 7,
    types: ["shopping.remove"],
  },
  {
    name: "bulk remove: clearing a 3-item list saves right away",
    text: "clear the list",
    list: SEVEN_ON_LIST.slice(0, 3),
    asks: null,
    types: ["shopping.remove"],
  },
  {
    name: "bulk remove: one thing off the list saves right away",
    text: "take oat milk off the list",
    list: SEVEN_ON_LIST,
    asks: null,
    types: ["shopping.remove"],
  },
  {
    name: "bulk remove: six staples dropped at once asks",
    text: "fish sauce, jasmine rice, eggs, garlic, tofu and limes aren't staples any more",
    staples: ["fish sauce", "jasmine rice", "eggs", "garlic", "tofu", "limes"].map((name) => ({ name, need: "have" as const })),
    asks: 6,
    types: ["staple.remove"],
  },
];
