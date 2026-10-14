/** Integration-test helpers: an embedded Postgres (PGlite) with the real migrations. */
import { randomUUID } from "node:crypto";
import { openLocalDb, type Db } from "@/db/client";
import { applyProposedChange, type ApplyOutcome } from "@/domains/kitchen/commands";
import { getKitchenVersion } from "@/domains/kitchen/queries";
import { createKitchen, createUser } from "@/shared/identity";
import { requireMember, type KitchenScope } from "@/shared/membership";
import type { OpInput } from "./memory-kitchen";

export { openLocalDb };

export interface TestKitchen {
  kitchenId: string;
  userIds: Record<string, string>;
  scope: (name: string) => Promise<KitchenScope>;
}

/** A fresh kitchen with fresh users (unique IDs, so tests in one DB don't collide). */
export async function newKitchen(db: Db, names: string[] = ["Vero"], opts: { isTest?: boolean } = {}): Promise<TestKitchen> {
  const suffix = randomUUID().slice(0, 8);
  const userIds: Record<string, string> = {};
  for (const name of names) {
    userIds[name] = `${name.toLowerCase()}-${suffix}`;
    await createUser(db, { id: userIds[name], displayName: name, isTest: opts.isTest });
  }
  const kitchenId = `kitchen-${suffix}`;
  await createKitchen(db, { id: kitchenId, name: "Test", isTest: opts.isTest, memberIds: Object.values(userIds) });
  return { kitchenId, userIds, scope: (name) => requireMember(db, userIds[name], kitchenId) };
}

export interface SendOptions {
  text?: string;
  proposalId?: string;
  basedOnVersion?: number;
  via?: "chat" | "button";
}

/** Build and apply a proposal. Chat by default; evidence defaults to the message text. */
export async function send(db: Db, scope: KitchenScope, ops: OpInput[], opts: SendOptions = {}): Promise<ApplyOutcome> {
  const via = opts.via ?? (opts.text ? "chat" : "button");
  const id = opts.proposalId ?? randomUUID();
  const proposal = {
    proposalId: id,
    kitchenId: scope.kitchenId,
    basedOnVersion: opts.basedOnVersion ?? (await getKitchenVersion(db, scope)),
    source: via === "chat" ? { via, messageId: id } : { via, action: "test" },
    operations: ops.map((op, i) => ({ opId: `op-${i + 1}`, ...(via === "chat" ? { evidence: opts.text } : {}), ...op })),
  };
  return applyProposedChange(db, scope, proposal, { messageText: opts.text });
}

/** `send`, asserting it saved. */
export async function ok(db: Db, scope: KitchenScope, ops: OpInput[], opts: SendOptions = {}) {
  const out = await send(db, scope, ops, opts);
  if (!out.ok) throw new Error(`apply failed: ${out.error.reason.text}`);
  return out.result;
}
