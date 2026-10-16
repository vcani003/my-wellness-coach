/**
 * Ask before removing more than 5 things at once (0045 KOS16): what counts, the question, the
 * yes/no reader, the held change's shape, the fake's removal phrases, and the eval cases run
 * against the fake (fake-runnable; the real-model run is `npm run eval`).
 */
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/messages/en.json";
import type { Operation } from "@/contracts/operations";
import {
  BULK_REMOVE_LIMIT,
  bulkConfirmFor,
  readConfirmAnswer,
  readPending,
  removals,
  toPending,
} from "@/ai/bulk-remove";
import { createFakeInterpreter } from "@/ai/fake";
import { BULK_REMOVE_CASES, bulkCaseRequest, checkBulkCase } from "@/ai/eval/bulk-remove-cases";
import { request, withStaples } from "@/ai/eval/fixtures";

const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
const state = withStaples(
  request("", [{ name: "milk" }, { name: "eggs" }, { name: "bread" }], [], [{ name: "oat milk" }, { name: "garlic" }]),
  [{ name: "fish sauce", need: "have" }],
).state;
let n = 0;
const op = (o: Record<string, unknown>) => ({ opId: String(++n), evidence: "x", ...o }) as Operation;
const out = (name: string) => op({ type: "item.use", target: { name }, fields: { stock: said("out") } });

describe("what counts as a removal", () => {
  it("counts remove, used up / Out, a batch gone, list removes and staple removes", () => {
    const ops = [
      op({ type: "item.remove", target: { itemId: "item-1" } }),
      op({ type: "item.use", target: { itemId: "item-2" }, fields: { stock: said("out") } }),
      op({ type: "item.stock.set", target: { itemId: "item-3" }, fields: { stock: said("out") } }),
      op({ type: "item.batch.close", target: { name: "yogurt", which: "oldest" } }),
      op({ type: "shopping.remove", target: { shoppingItemId: "shop-1" } }),
      op({ type: "staple.remove", target: { stapleId: "fish sauce" } }),
    ];
    expect(removals(ops, state).map((r) => [r.name, r.where])).toEqual([
      ["milk", "kitchen"],
      ["eggs", "kitchen"],
      ["bread", "kitchen"],
      ["yogurt", "kitchen"],
      ["oat milk", "list"],
      ["fish sauce", "staples"],
    ]);
  });

  it("doesn't count a use that leaves some, Low, a level, ticks, adds, moves or Undo", () => {
    const ops = [
      op({ type: "item.use", target: { name: "milk" }, fields: { stock: said("low") } }),
      op({ type: "item.use", target: { name: "eggs" }, fields: { amountUsed: said({ asSaid: "2" }) } }),
      op({ type: "item.stock.set", target: { name: "bread" }, fields: { stock: said("some") } }),
      op({ type: "shopping.tick", target: { shoppingItemId: "shop-1" }, ticked: true }),
      op({ type: "item.add", fields: { name: said("rice") } }),
      op({ type: "item.update", target: { name: "milk" }, fields: { location: said("freezer") } }),
      op({ type: "changeset.revert", target: { changeSetId: "cs-1" } }),
    ];
    expect(removals(ops, state)).toEqual([]);
  });

  it("counts each thing once, however many operations touch it", () => {
    const ops = [out("milk"), op({ type: "item.remove", target: { name: "Milk" } }), out("eggs")];
    expect(removals(ops, state)).toHaveLength(2);
  });
});

describe("when to ask", () => {
  const six = ["milk", "eggs", "bread", "rice", "butter", "cheese"];

  it(`asks at ${BULK_REMOVE_LIMIT + 1}, never at ${BULK_REMOVE_LIMIT}`, () => {
    expect(BULK_REMOVE_LIMIT).toBe(5);
    expect(bulkConfirmFor(six.slice(0, 5).map(out), state)).toBeNull();
    const confirm = bulkConfirmFor(six.map(out), state);
    expect(confirm).toMatchObject({ kind: "bulk-remove", count: 6, names: six });
    expect(confirm?.reply).toBe("That would remove 6 things: milk, eggs, bread, rice, butter, and cheese. Remove them all?");
  });

  it("says where when it's all one list, and marks the place when they're mixed", () => {
    const list = Array.from({ length: 6 }, (_, i) => op({ type: "shopping.remove", target: { name: `thing ${i + 1}` } }));
    expect(bulkConfirmFor(list, state)?.reply).toMatch(/^That would remove 6 things from your shopping list: thing 1, /);
    const mixed = bulkConfirmFor([...six.slice(0, 5).map(out), op({ type: "staple.remove", target: { name: "fish sauce" } })], state);
    expect(mixed?.names.at(-1)).toBe("fish sauce (staples)");
    expect(mixed?.names[0]).toBe("milk");
  });

  it("names the first 10, counts the rest, and says nothing saves when the message did more", () => {
    const many = Array.from({ length: 13 }, (_, i) => out(`thing ${i + 1}`));
    const confirm = bulkConfirmFor([...many, op({ type: "item.add", fields: { name: said("rice") } })], state);
    expect(confirm?.names).toHaveLength(13);
    expect(confirm?.reply).toContain("thing 10, and 3 more. Remove them all? Nothing from that message is saved until you say yes.");
  });
});

describe("reading the answer", () => {
  it.each(["yes", "Yes!", "yep", "ok", "sure.", "do it", "go ahead", "yes please", "Yes, remove them", "remove them all", "yes, remove them all", "Yes, all of them"])(
    "%s → yes",
    (text) => expect(readConfirmAnswer(text)).toBe("yes"),
  );
  it.each(["no", "No.", "nope", "cancel", "never mind", "No, keep them", "keep them", "no thanks", "don’t"])("%s → no", (text) =>
    expect(readConfirmAnswer(text)).toBe("no"),
  );
  it.each(["yes but keep the eggs", "just the milk", "remove the milk and eggs", "what?", "I bought rice", "not the cheese"])(
    "%s → neither (read as a new message)",
    (text) => expect(readConfirmAnswer(text)).toBeNull(),
  );

  it("the Yes / No buttons' words are read as yes and no (en.json chat.confirm)", () => {
    expect(readConfirmAnswer(en.chat.confirm.yes)).toBe("yes");
    expect(readConfirmAnswer(en.chat.confirm.no)).toBe("no");
  });
});

describe("the held change", () => {
  it("round-trips, and an unreadable one is null (logged), never a crash (0018)", () => {
    const ops = ["a", "b", "c", "d", "e", "f"].map(out);
    const confirm = bulkConfirmFor(ops, state)!;
    const pending = toPending(confirm, { version: 4, sourceMessageId: "m1", messageText: "we're out of …", operations: ops, followUps: [] });
    expect(readPending(JSON.parse(JSON.stringify(pending)))).toEqual(pending);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(readPending({ kind: "bulk-remove", operations: "nope" })).toBeNull();
    expect(readPending(null)).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("the fake's removal phrases", () => {
  const fake = createFakeInterpreter();
  const opsFor = async (text: string, list = [] as { name: string }[]) =>
    (await fake.interpret({ ...request(text, [], [], list) })).proposal?.operations ?? [];

  it("take X off the list · clear the list · throw out X", async () => {
    expect(await opsFor("take oat milk and garlic off the list")).toMatchObject([
      { type: "shopping.remove", target: { name: "oat milk" } },
      { type: "shopping.remove", target: { name: "garlic" } },
    ]);
    expect(await opsFor("clear the list", [{ name: "oat milk" }, { name: "garlic" }])).toMatchObject([
      { type: "shopping.remove", target: { shoppingItemId: "shop-1" } },
      { type: "shopping.remove", target: { shoppingItemId: "shop-2" } },
    ]);
    expect((await fake.interpret(request("clear my shopping list"))).reply).toBe("Your list is already empty.");
    expect(await opsFor("throw out the milk and eggs")).toMatchObject([
      { type: "item.remove", target: { name: "milk" } },
      { type: "item.remove", target: { name: "eggs" } },
    ]);
  });

  it("leaves staples and list adds alone", async () => {
    expect((await opsFor("take hoisin off my staples"))[0]?.type).toBe("staple.remove");
    expect((await opsFor("add garlic to the list"))[0]?.type).toBe("shopping.add");
  });
});

describe("eval cases against the fake interpreter (fake-runnable)", () => {
  const fake = createFakeInterpreter();
  it.each(BULK_REMOVE_CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const req = bulkCaseRequest(c);
    checkBulkCase(c, req, await fake.interpret(req));
  });
});
