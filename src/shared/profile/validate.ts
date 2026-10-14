/**
 * Profile operation rules (backend-data.md §5–§7, 0012, 0019). Pure.
 * Evidence and paste checks happen before this, in the planner, for every operation.
 *
 * - A restriction is saved only with `basis: said` (NOT_SAID otherwise); never inferred.
 * - Adding one for another member is allowed only for a member of the same kitchen. Asking the
 *   speaker to confirm first is the AI's job (ai.md §4, OPEN-QUESTIONS AI7 Rec).
 * - Only the profile's owner can update a restriction's note, remove it, or verify it (AI7).
 * - A lasting preference needs the ID of the message where the user said "yes".
 */
import type { OperationOf } from "@/contracts/operations";
import { msg } from "@/shared/messages";
import { reject, type EventFactory, type OpOutcome } from "@/shared/ops";
import { normalizeText, standardName } from "@/shared/text";
import { userStream } from "@/shared/events/types";
import {
  PROFILE_EVENT,
  type PreferenceRemovedPayload,
  type PreferenceSavedPayload,
  type ProfileState,
  type RestrictionAddedPayload,
  type RestrictionRemovedPayload,
  type RestrictionUpdatedPayload,
  type RestrictionVerifiedPayload,
} from "./state";

export interface ProfileValidationContext {
  actorId: string;
  /** Members of the kitchen the proposal came through: userId → display name. */
  members: Map<string, string>;
  profiles: ProfileState;
  newId: () => string;
  make: EventFactory;
}

type ProfileOp = OperationOf<
  | "profile.restriction.add"
  | "profile.restriction.update"
  | "profile.restriction.remove"
  | "profile.restriction.verify"
  | "profile.preference.save"
  | "profile.preference.remove"
>;

const subjectKey = (s: string) => standardName(s).replace(/ allergy$/, "");

export function validateProfileOperation(op: ProfileOp, ctx: ProfileValidationContext): OpOutcome {
  switch (op.type) {
    case "profile.restriction.verify": {
      const existing = ctx.profiles.restrictions[op.target.restrictionId];
      const name = existing ? ctx.members.get(existing.userId) : undefined;
      if (!existing || !name) return reject("UNKNOWN_TARGET");
      if (existing.userId !== ctx.actorId) return reject("NOT_ALLOWED");
      if (existing.verifiedAt) return { ok: true, events: [], summary: msg("NO_CHANGE"), refs: [] };
      const payload: RestrictionVerifiedPayload = { restrictionId: existing.id };
      return {
        ok: true,
        events: [ctx.make(userStream(existing.userId), PROFILE_EVENT.restrictionVerified, payload)],
        summary: msg("RESTRICTION_VERIFIED", { name, kind: existing.kind, subject: existing.subject.value }),
        refs: [{ kind: "profile", id: existing.id, change: "updated" }],
      };
    }
    case "profile.restriction.add":
    case "profile.restriction.update":
    case "profile.restriction.remove": {
      const forUserId = op.forUserId ?? ctx.actorId;
      const name = ctx.members.get(forUserId);
      if (!name) return reject("NOT_ALLOWED");
      if (op.fields.subject.basis !== "said") return reject("NOT_SAID");
      const key = subjectKey(op.fields.subject.value);
      const existing = Object.values(ctx.profiles.restrictions).find(
        (r) => r.userId === forUserId && r.kind === op.fields.kind && r.subjectKey === key,
      );
      const params = { name, kind: op.fields.kind, subject: op.fields.subject.value };

      if (op.type === "profile.restriction.add") {
        if (op.fields.note && op.fields.note.basis !== "said") return reject("NOT_SAID");
        if (existing) {
          // Already saved: treat as a note update when the owner adds one, else nothing to do.
          if (!op.fields.note || forUserId !== ctx.actorId) {
            return { ok: true, events: [], summary: msg("NO_CHANGE"), refs: [] };
          }
          const payload: RestrictionUpdatedPayload = { restrictionId: existing.id, note: op.fields.note };
          return {
            ok: true,
            events: [ctx.make(userStream(forUserId), PROFILE_EVENT.restrictionUpdated, payload)],
            summary: msg("RESTRICTION_UPDATED", params),
            refs: [{ kind: "profile", id: existing.id, change: "updated" }],
          };
        }
        const payload: RestrictionAddedPayload = {
          restrictionId: ctx.newId(),
          userId: forUserId,
          kind: op.fields.kind,
          subject: op.fields.subject,
          subjectKey: key,
          ...(op.fields.note ? { note: op.fields.note } : {}),
        };
        return {
          ok: true,
          events: [ctx.make(userStream(forUserId), PROFILE_EVENT.restrictionAdded, payload)],
          summary: msg("RESTRICTION_ADDED", params),
          refs: [{ kind: "profile", id: payload.restrictionId, change: "added" }],
        };
      }

      if (!existing) return reject("UNKNOWN_TARGET");
      if (forUserId !== ctx.actorId) return reject("NOT_ALLOWED");

      if (op.type === "profile.restriction.update") {
        if (op.fields.note && op.fields.note.basis !== "said") return reject("NOT_SAID");
        const payload: RestrictionUpdatedPayload = { restrictionId: existing.id, note: op.fields.note ?? null };
        return {
          ok: true,
          events: [ctx.make(userStream(forUserId), PROFILE_EVENT.restrictionUpdated, payload)],
          summary: msg("RESTRICTION_UPDATED", params),
          refs: [{ kind: "profile", id: existing.id, change: "updated" }],
        };
      }
      const payload: RestrictionRemovedPayload = { restrictionId: existing.id };
      return {
        ok: true,
        events: [ctx.make(userStream(forUserId), PROFILE_EVENT.restrictionRemoved, payload)],
        summary: msg("RESTRICTION_REMOVED", params),
        refs: [{ kind: "profile", id: existing.id, change: "removed" }],
      };
    }

    case "profile.preference.save": {
      const key = normalizeText(op.fields.statement.value);
      const existing = Object.values(ctx.profiles.preferences).find(
        (p) => p.userId === ctx.actorId && p.statementKey === key,
      );
      if (existing) return { ok: true, events: [], summary: msg("NO_CHANGE"), refs: [] };
      const payload: PreferenceSavedPayload = {
        preferenceId: ctx.newId(),
        userId: ctx.actorId,
        statement: op.fields.statement,
        statementKey: key,
        confirmedByMessageId: op.confirmedByMessageId,
      };
      return {
        ok: true,
        events: [ctx.make(userStream(ctx.actorId), PROFILE_EVENT.preferenceSaved, payload)],
        summary: msg("PREFERENCE_SAVED", { statement: op.fields.statement.value }),
        refs: [{ kind: "profile", id: payload.preferenceId, change: "added" }],
      };
    }

    case "profile.preference.remove": {
      const key = normalizeText(op.fields.statement.value);
      const existing = Object.values(ctx.profiles.preferences).find(
        (p) => p.userId === ctx.actorId && p.statementKey === key,
      );
      if (!existing) return reject("UNKNOWN_TARGET");
      const payload: PreferenceRemovedPayload = { preferenceId: existing.id };
      return {
        ok: true,
        events: [ctx.make(userStream(ctx.actorId), PROFILE_EVENT.preferenceRemoved, payload)],
        summary: msg("PREFERENCE_REMOVED", { statement: existing.statement.value }),
        refs: [{ kind: "profile", id: existing.id, change: "removed" }],
      };
    }
  }
}
