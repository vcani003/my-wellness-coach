/** Profile projections: load into the pure state, and write touched entities back. */
import { eq, inArray } from "drizzle-orm";
import { profilePreferences, profileRestrictions } from "@/db/schema";
import type { Queryable } from "@/db/client";
import type { RestrictionKind } from "@/contracts/common";
import { compact, splitEntityKey } from "@/shared/events/types";
import type { Preference, ProfileState, Restriction } from "./state";

type RestrictionRow = typeof profileRestrictions.$inferSelect;
type PreferenceRow = typeof profilePreferences.$inferSelect;

const iso = (d: Date) => d.toISOString();

function restrictionFromRow(r: RestrictionRow): Restriction {
  return compact({
    id: r.id,
    userId: r.userId,
    kind: r.kind as RestrictionKind,
    subject: r.subject,
    subjectKey: r.subjectKey,
    note: r.note ?? undefined,
    verifiedAt: r.verifiedAt ? iso(r.verifiedAt) : undefined,
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
    updatedAt: iso(r.updatedAt),
    updatedBy: r.updatedBy,
  });
}

function preferenceFromRow(r: PreferenceRow): Preference {
  return {
    id: r.id,
    userId: r.userId,
    statement: r.statement,
    statementKey: r.statementKey,
    confirmedByMessageId: r.confirmedByMessageId,
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
    updatedAt: iso(r.updatedAt),
    updatedBy: r.updatedBy,
  };
}

export async function loadProfiles(db: Queryable, userIds: string[]): Promise<ProfileState> {
  if (userIds.length === 0) return { restrictions: {}, preferences: {} };
  const [rs, ps] = await Promise.all([
    db.select().from(profileRestrictions).where(inArray(profileRestrictions.userId, userIds)),
    db.select().from(profilePreferences).where(inArray(profilePreferences.userId, userIds)),
  ]);
  return {
    restrictions: Object.fromEntries(rs.map((r) => [r.id, restrictionFromRow(r)])),
    preferences: Object.fromEntries(ps.map((p) => [p.id, preferenceFromRow(p)])),
  };
}

/** Write the current value of each touched profile entity (delete when it no longer exists). */
export async function persistProfileEntities(db: Queryable, state: ProfileState, keys: Iterable<string>): Promise<void> {
  for (const key of keys) {
    const { kind, id } = splitEntityKey(key);
    if (kind === "restriction") {
      const r = state.restrictions[id];
      await db.delete(profileRestrictions).where(eq(profileRestrictions.id, id));
      if (r) {
        await db.insert(profileRestrictions).values({
          id: r.id,
          userId: r.userId,
          kind: r.kind,
          subject: r.subject,
          subjectKey: r.subjectKey,
          note: r.note ?? null,
          verifiedAt: r.verifiedAt ? new Date(r.verifiedAt) : null,
          createdAt: new Date(r.createdAt),
          createdBy: r.createdBy,
          updatedAt: new Date(r.updatedAt),
          updatedBy: r.updatedBy,
        });
      }
    } else if (kind === "preference") {
      const p = state.preferences[id];
      await db.delete(profilePreferences).where(eq(profilePreferences.id, id));
      if (p) {
        await db.insert(profilePreferences).values({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        });
      }
    }
  }
}

/** Replace every profile row of these users (used by rebuild-projections). */
export async function replaceProfiles(db: Queryable, userIds: string[], state: ProfileState): Promise<void> {
  if (userIds.length === 0) return;
  await db.delete(profileRestrictions).where(inArray(profileRestrictions.userId, userIds));
  await db.delete(profilePreferences).where(inArray(profilePreferences.userId, userIds));
  const keys = [
    ...Object.keys(state.restrictions).map((id) => `restriction:${id}`),
    ...Object.keys(state.preferences).map((id) => `preference:${id}`),
  ];
  await persistProfileEntities(db, state, keys);
}
