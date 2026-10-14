/**
 * Settings, backend half (P2 b): "Sign out everywhere" (0017), export and delete (0015, D1), and
 * the profile's verify / remove buttons (0019, AI7). On PGlite with the real migrations.
 */
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLocalDb, type Db } from "@/db/client";
import { changeSets, chatMessages, deletedUsers, events, kitchens, mealIdeas, profileRestrictions, users } from "@/db/schema";
import { saveUserMessage } from "@/domains/chat/commands";
import { getChangesSince, getKitchenState } from "@/domains/kitchen/queries";
import { recordMealIdeas, undo } from "@/domains/kitchen/commands";
import { codeFingerprint } from "@/lib/auth/access-codes";
import { resolveCurrentUser } from "@/lib/auth/current-user";
import { gate } from "@/lib/auth/gate";
import { issueSession, sessionCookieName, verifySession } from "@/lib/auth/session";
import { attemptUnlock } from "@/lib/auth/unlock";
import { parseEnv, type Env } from "@/lib/env";
import { deleteMyData } from "@/server/account/delete";
import { buildExport } from "@/server/account/export";
import { bumpSessionEpoch } from "@/server/account/sessions";
import { getSettingsView, removeRestriction, verifyRestriction } from "@/server/account/settings";
import { createKitchen, createUser } from "@/shared/identity";
import { requireMember } from "@/shared/membership";
import { bootstrap } from "../../scripts/bootstrap";
import { newKitchen, ok } from "../support/db";
import { said } from "../support/memory-kitchen";

const VERO_CODE = "vero-settings-code-111";
const LEVI_CODE = "levi-settings-code-222";
const SECRET = "test-session-secret-settings-0123456789";
const e: Env = parseEnv({ NODE_ENV: "test", SESSION_SECRET: SECRET, ACCESS_CODES: `vero=${VERO_CODE},levi=${LEVI_CODE}` });
const cfg = { secret: SECRET, accessCodes: e.ACCESS_CODES!, production: false };
const T0 = new Date("2026-10-14T12:00:00Z");

let db: Db;
let close: () => Promise<void>;
let ip = 0;
const unlock = (code: string, now = T0) => attemptUnlock(db, e, { code, ip: `10.9.0.${++ip}` }, now);
const whoIs = (token: string, now = T0) => resolveCurrentUser(db, e, { sessionToken: token }, now);

beforeAll(async () => {
  ({ db, close } = await openLocalDb());
  await bootstrap(db);
});
afterAll(() => close());

describe("sign out everywhere (0017)", () => {
  it("invalidates every cookie issued before, on any device; a fresh unlock works again", async () => {
    const phone = await unlock(VERO_CODE);
    const laptop = await unlock(VERO_CODE);
    if (!phone.ok || !laptop.ok) throw new Error("unlock failed");
    expect(await whoIs(phone.token)).toMatchObject({ id: "vero" });

    expect(await bumpSessionEpoch(db, "vero")).toBe(1);
    expect(await whoIs(phone.token)).toBeNull();
    expect(await whoIs(laptop.token)).toBeNull();
    // Levi isn't affected.
    const levi = await unlock(LEVI_CODE);
    expect(levi.ok && (await whoIs(levi.token))).toMatchObject({ id: "levi" });

    const again = await unlock(VERO_CODE);
    expect(again.ok && (await whoIs(again.token))).toMatchObject({ id: "vero" });
  });

  it("the proxy's daily roll keeps the old epoch, so a signed-out cookie can't be refreshed back to life", async () => {
    const before = await unlock(VERO_CODE);
    if (!before.ok) throw new Error("unlock failed");
    await bumpSessionEpoch(db, "vero");
    const twoDays = new Date(T0.getTime() + 2 * 86_400_000);
    const name = sessionCookieName(false);
    const res = gate(new NextRequest("http://localhost/", { headers: { cookie: `${name}=${before.token}` } }), e, twoDays);
    const rolled = res.cookies.get(name)?.value;
    expect(rolled).toBeTruthy();
    expect(await whoIs(rolled!, twoDays)).toBeNull();
  });

  it("a cookie from before migration 0007 (no epoch) still works while the epoch is 0", async () => {
    await createUser(db, { id: "legacy", displayName: "Legacy" });
    const codes = `${e.ACCESS_CODES},legacy=legacy-code-123456`;
    const iat = Math.floor(T0.getTime() / 1000);
    const data = Buffer.from(
      JSON.stringify({ v: 1, u: "legacy", k: codeFingerprint(SECRET, "legacy-code-123456"), iat, exp: iat + 1000 }),
    ).toString("base64url");
    const token = `${data}.${createHmac("sha256", SECRET).update(`session:${data}`).digest("base64url")}`;
    const env2 = parseEnv({ NODE_ENV: "test", SESSION_SECRET: SECRET, ACCESS_CODES: codes });
    expect(await resolveCurrentUser(db, env2, { sessionToken: token }, T0)).toMatchObject({ id: "legacy" });
    await bumpSessionEpoch(db, "legacy");
    expect(await resolveCurrentUser(db, env2, { sessionToken: token }, T0)).toBeNull();
  });

  it("verifySession refuses a different epoch when one is given, and never throws on a bad one", () => {
    const token = issueSession(cfg, "vero", T0, 3)!;
    expect(verifySession(cfg, token, T0)?.epoch).toBe(3);
    expect(verifySession(cfg, token, T0, 3)).not.toBeNull();
    expect(verifySession(cfg, token, T0, 4)).toBeNull();
  });
});

describe("Settings view and the verify / remove buttons (0019, AI7)", () => {
  it("shows provenance; only the owner can verify or remove", async () => {
    const t = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await t.scope("Vero");
    const levi = await t.scope("Levi");
    // Vero tells Kitchen about Levi's allergy; Levi adds his own diet.
    await ok(
      db,
      vero,
      [{ type: "profile.restriction.add", forUserId: t.userIds.Levi, evidence: "allergic to seafood", fields: { kind: "allergy", subject: said("seafood") } }],
      { text: "Levi is allergic to seafood" },
    );
    await ok(db, levi, [{ type: "profile.restriction.add", evidence: "vegetarian", fields: { kind: "diet", subject: said("vegetarian") } }], {
      text: "I'm vegetarian on weekdays",
    });

    const view = (await getSettingsView(db, t.userIds.Levi))!;
    expect(view.me).toEqual({ id: t.userIds.Levi, name: "Levi" });
    expect(view.kitchen).toMatchObject({ id: t.kitchenId, isTest: false });
    expect(view.members.map((m) => [m.name, m.isYou])).toEqual([["Vero", false], ["Levi", true]]);
    const [allergy, diet] = view.restrictions;
    expect(allergy).toMatchObject({ kind: "allergy", subject: "seafood", addedBy: { id: t.userIds.Vero, name: "Vero" }, addedByYou: false, verified: false });
    expect(diet).toMatchObject({ kind: "diet", subject: "vegetarian", addedByYou: true, verified: true });

    // Vero can't verify or remove Levi's allergy.
    const veroVerify = await verifyRestriction(db, vero, { tapId: "v-1", restrictionId: allergy.id });
    expect(veroVerify.ok && veroVerify.result.rejected[0].reason.code).toBe("NOT_ALLOWED");
    const veroRemove = await removeRestriction(db, vero, { tapId: "v-2", restrictionId: allergy.id });
    expect(veroRemove.ok && veroRemove.result.rejected[0].reason.code).toBe("NOT_ALLOWED");

    // Levi keeps it: verified, and a second tap changes nothing.
    const kept = await verifyRestriction(db, levi, { tapId: "l-1", restrictionId: allergy.id });
    expect(kept.ok && kept.result.applied[0].summary.code).toBe("RESTRICTION_VERIFIED");
    expect((await getSettingsView(db, t.userIds.Levi))!.restrictions[0]).toMatchObject({ verified: true, addedByYou: false });
    const again = await verifyRestriction(db, levi, { tapId: "l-2", restrictionId: allergy.id });
    expect(again.ok && again.result.applied[0].summary.code).toBe("NO_CHANGE");

    // Undo puts it back to unverified (it's an ordinary change set).
    if (!kept.ok) throw new Error("verify failed");
    const undone = await undo(db, levi, { changeSetId: kept.result.changeSetId, tapId: "l-undo", basedOnVersion: kept.result.newVersion });
    expect(undone.ok && undone.result.applied[0].summary.code).toBe("UNDONE");
    expect((await getSettingsView(db, t.userIds.Levi))!.restrictions[0].verified).toBe(false);
    // Levi removes his own allergy; an unknown ID is UNKNOWN_TARGET.
    const removed = await removeRestriction(db, levi, { tapId: "l-3", restrictionId: allergy.id });
    expect(removed.ok && removed.result.applied[0].summary.code).toBe("RESTRICTION_REMOVED");
    expect((await getSettingsView(db, t.userIds.Levi))!.restrictions.map((r) => r.subject)).toEqual(["vegetarian"]);
    const gone = await removeRestriction(db, levi, { tapId: "l-4", restrictionId: allergy.id });
    expect(gone).toMatchObject({ ok: false, error: { reason: { code: "UNKNOWN_TARGET" } } });
  });

  it("editing your own note also counts as verifying (AI7: keep, edit the note, or remove)", async () => {
    const t = await newKitchen(db, ["Vero", "Levi"]);
    await ok(
      db,
      await t.scope("Vero"),
      [{ type: "profile.restriction.add", forUserId: t.userIds.Levi, evidence: "allergic to peanuts", fields: { kind: "allergy", subject: said("peanuts") } }],
      { text: "Levi is allergic to peanuts" },
    );
    expect((await getSettingsView(db, t.userIds.Levi))!.restrictions[0].verified).toBe(false);
    await ok(
      db,
      await t.scope("Levi"),
      [{ type: "profile.restriction.update", evidence: "only raw ones", fields: { kind: "allergy", subject: said("peanuts"), note: said("only raw ones") } }],
      { text: "my peanut allergy is only raw ones" },
    );
    expect((await getSettingsView(db, t.userIds.Levi))!.restrictions[0]).toMatchObject({ verified: true, note: "only raw ones" });
  });
});

describe("export (0015)", () => {
  it("has your profile with provenance, only your chats, and your kitchens' events and state", async () => {
    const t = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await t.scope("Vero");
    const levi = await t.scope("Levi");
    await ok(db, vero, [{ type: "item.add", evidence: "eggs", fields: { name: said("eggs") } }], { text: "I bought eggs" });
    await ok(
      db,
      vero,
      [{ type: "profile.restriction.add", forUserId: t.userIds.Levi, evidence: "allergic to seafood", fields: { kind: "allergy", subject: said("seafood") } }],
      { text: "Levi is allergic to seafood" },
    );
    await saveUserMessage(db, vero, { clientMessageId: "c-v", text: "VERO-PRIVATE I bought eggs" });
    await saveUserMessage(db, levi, { clientMessageId: "c-l", text: "LEVI-PRIVATE what's for dinner" });

    // Another kitchen Levi isn't in: never in his export.
    const other = await newKitchen(db, ["Sam"]);
    await ok(db, await other.scope("Sam"), [{ type: "item.add", evidence: "tofu", fields: { name: said("tofu") } }], { text: "tofu" });

    const data = (await buildExport(db, t.userIds.Levi, T0))!;
    const text = JSON.stringify(data);
    expect(data).toMatchObject({ format: "kitchen-assistant-export", version: 1, you: { id: t.userIds.Levi, name: "Levi" } });
    expect(data.chats.map((c) => c.text)).toEqual(["LEVI-PRIVATE what's for dinner"]);
    expect(text).not.toContain("VERO-PRIVATE"); // H2: never another member's chat
    expect(text).not.toContain(other.kitchenId);
    expect(text).not.toContain("tofu");
    expect(data.profile.restrictions[0]).toMatchObject({ subject: { value: "seafood" }, addedBy: { name: "Vero" }, verified: false });
    expect(data.profile.events.map((ev) => ev.type)).toEqual(["profile.restriction.added"]);
    expect(data.kitchens).toHaveLength(1);
    expect(data.kitchens[0].state.items.map((i) => i.name.value)).toEqual(["eggs"]);
    expect(data.kitchens[0].events.map((ev) => ev.type)).toContain("item.added");
    expect(data.kitchens[0].members.map((m) => m.name)).toEqual(["Vero", "Levi"]);

    expect(await buildExport(db, "nobody-here", T0)).toBeNull();
  });
});

describe("delete my data (D1, 0015)", () => {
  it("removes you; your kitchen changes stay as 'a former member'; the kitchen stays for the other member", async () => {
    const t = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await t.scope("Vero");
    const levi = await t.scope("Levi");
    await ok(db, levi, [{ type: "item.add", evidence: "rice", fields: { name: said("rice") } }], { text: "I bought rice" });
    await ok(
      db,
      vero,
      [{ type: "profile.restriction.add", forUserId: t.userIds.Levi, evidence: "allergic to seafood", fields: { kind: "allergy", subject: said("seafood") } }],
      { text: "Levi is allergic to seafood" },
    );
    await ok(db, levi, [{ type: "profile.preference.save", fields: { statement: said("spicy food") }, confirmedByMessageId: "m-1" }]);
    await saveUserMessage(db, levi, { clientMessageId: "c-l", text: "hello" });
    await saveUserMessage(db, vero, { clientMessageId: "c-v", text: "hi" });
    await recordMealIdeas(db, levi, { basedOnVersion: 1, ideas: [{ name: "Rice bowl", why: "rice", uses: [], missing: [] }] });

    // A separate test kitchen with a tester account: must be untouched.
    const testers = await newKitchen(db, ["Tess"], { isTest: true });
    await ok(db, await testers.scope("Tess"), [{ type: "item.add", evidence: "milk", fields: { name: said("milk") } }], { text: "milk" });

    const out = await deleteMyData(db, t.userIds.Levi, T0);
    expect(out).toEqual({ ok: true, deletedKitchenIds: [], keptKitchenIds: [t.kitchenId] });

    // Gone: account, chats, profile (rows and stream), idea cards.
    expect(await db.select().from(users).where(eq(users.id, t.userIds.Levi))).toEqual([]);
    expect((await db.select().from(chatMessages).where(eq(chatMessages.kitchenId, t.kitchenId))).map((c) => c.text)).toEqual(["hi"]);
    expect(await db.select().from(profileRestrictions).where(eq(profileRestrictions.userId, t.userIds.Levi))).toEqual([]);
    expect(await db.select().from(events).where(eq(events.stream, `user:${t.userIds.Levi}`))).toEqual([]);
    expect(await db.select().from(mealIdeas).where(eq(mealIdeas.kitchenId, t.kitchenId))).toEqual([]);
    expect(await db.select().from(deletedUsers).where(eq(deletedUsers.id, t.userIds.Levi))).toHaveLength(1);

    // Kept: the kitchen, Levi's events, and his rice, shown as added by a former member.
    const state = await getKitchenState(db, vero);
    expect(state.items[0]).toMatchObject({ name: { value: "rice" }, createdBy: { id: t.userIds.Levi, missing: true, former: true } });
    const kitchenEvents = await db.select().from(events).where(eq(events.stream, `kitchen:${t.kitchenId}`));
    expect(kitchenEvents.some((ev) => ev.actorId === t.userIds.Levi)).toBe(true);
    const feed = await getChangesSince(db, vero, 0);
    expect(feed[0].actor).toEqual({ id: t.userIds.Levi, missing: true, former: true });
    // Vero's change set that saved Levi's allergy no longer repeats it.
    const scrubbed = await db.select({ summaries: changeSets.summaries }).from(changeSets).where(eq(changeSets.kitchenId, t.kitchenId));
    expect(JSON.stringify(scrubbed)).not.toContain("seafood");
    expect(feed.flatMap((f) => f.summaries.map((s) => s.code))).toContain("FORMER_MEMBER_PROFILE");

    // Vero is fine; the test kitchen is untouched.
    expect((await getSettingsView(db, t.userIds.Vero))!.members.map((m) => m.name)).toEqual(["Vero"]);
    const tess = await testers.scope("Tess");
    expect((await getKitchenState(db, tess)).items.map((i) => i.name.value)).toEqual(["milk"]);

    // Levi's ID can't be recreated.
    await expect(createUser(db, { id: t.userIds.Levi, displayName: "Levi" })).rejects.toThrow();

    // The last member deleting removes the kitchen and its events.
    const last = await deleteMyData(db, t.userIds.Vero, T0);
    expect(last).toEqual({ ok: true, deletedKitchenIds: [t.kitchenId], keptKitchenIds: [] });
    expect(await db.select().from(kitchens).where(eq(kitchens.id, t.kitchenId))).toEqual([]);
    expect(await db.select().from(events).where(eq(events.stream, `kitchen:${t.kitchenId}`))).toEqual([]);
    expect((await getKitchenState(db, tess)).items).toHaveLength(1);

    expect(await deleteMyData(db, t.userIds.Vero, T0)).toEqual({ ok: false, reason: "not_found" });
  });

  it("a tester deleting only touches their test kitchen; a real kitchen nearby is untouched", async () => {
    const real = await newKitchen(db, ["Ana"]);
    await ok(db, await real.scope("Ana"), [{ type: "item.add", evidence: "bread", fields: { name: said("bread") } }], { text: "bread" });
    const test = await newKitchen(db, ["Tess"], { isTest: true });
    await ok(db, await test.scope("Tess"), [{ type: "item.add", evidence: "milk", fields: { name: said("milk") } }], { text: "milk" });

    expect(await deleteMyData(db, test.userIds.Tess, T0)).toMatchObject({ ok: true, deletedKitchenIds: [test.kitchenId] });
    expect((await getKitchenState(db, await real.scope("Ana"))).items.map((i) => i.name.value)).toEqual(["bread"]);
  });

  it("a deleted person's code is refused with a clear reason, and db:bootstrap doesn't recreate them", async () => {
    const levi = await unlock(LEVI_CODE);
    if (!levi.ok) throw new Error("unlock failed");
    await createKitchen(db, { id: "levi-solo", name: "Solo", memberIds: ["levi"] });

    expect(await deleteMyData(db, "levi", T0)).toMatchObject({ ok: true, keptKitchenIds: ["home"], deletedKitchenIds: ["levi-solo"] });
    expect(await whoIs(levi.token)).toBeNull(); // the old cookie is dead
    expect(await unlock(LEVI_CODE)).toEqual({ ok: false, reason: "deleted" });

    const report = await bootstrap(db);
    expect(report).toMatchObject({ createdUsers: [], skippedDeleted: ["levi"] });
    expect(await db.select().from(users).where(eq(users.id, "levi"))).toEqual([]);
    expect(await requireMember(db, "vero", "home")).toMatchObject({ kitchenId: "home" });
  });
});
