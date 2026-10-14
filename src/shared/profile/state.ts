/**
 * The shared profile (backend-data.md §5): allergies and diets with the person's own note (0019),
 * and lasting preferences (0012). Lives in `user:<id>` streams, apart from any one kitchen.
 */
import type { Fact, RestrictionKind } from "@/contracts/common";
import {
  CHANGESET_REVERTED,
  compact,
  splitEntityKey,
  type AuditFields,
  type ChangesetRevertedPayload,
  type EventEnvelope,
} from "@/shared/events/types";

export interface Restriction extends AuditFields {
  id: string;
  userId: string;
  kind: RestrictionKind;
  subject: Fact<string>;
  subjectKey: string;
  note?: Fact<string>;
}

export interface Preference extends AuditFields {
  id: string;
  userId: string;
  statement: Fact<string>;
  statementKey: string;
  confirmedByMessageId: string;
}

export interface ProfileState {
  restrictions: Record<string, Restriction>;
  preferences: Record<string, Preference>;
}

export const emptyProfileState = (): ProfileState => ({ restrictions: {}, preferences: {} });

export type ProfileEntity = Restriction | Preference;

export const PROFILE_EVENT = {
  restrictionAdded: "profile.restriction.added",
  restrictionUpdated: "profile.restriction.updated",
  restrictionRemoved: "profile.restriction.removed",
  preferenceSaved: "profile.preference.saved",
  preferenceRemoved: "profile.preference.removed",
} as const;

export interface RestrictionAddedPayload {
  restrictionId: string;
  userId: string;
  kind: RestrictionKind;
  subject: Fact<string>;
  subjectKey: string;
  note?: Fact<string>;
}
export interface RestrictionUpdatedPayload {
  restrictionId: string;
  /** null = the note is cleared back to unknown. */
  note: Fact<string> | null;
}
export interface RestrictionRemovedPayload {
  restrictionId: string;
}
export interface PreferenceSavedPayload {
  preferenceId: string;
  userId: string;
  statement: Fact<string>;
  statementKey: string;
  confirmedByMessageId: string;
}
export interface PreferenceRemovedPayload {
  preferenceId: string;
}

/** Entity keys a profile event touches (for Undo conflicts). */
export function profileTouchedKeys(event: EventEnvelope): string[] {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case PROFILE_EVENT.restrictionAdded:
    case PROFILE_EVENT.restrictionUpdated:
    case PROFILE_EVENT.restrictionRemoved:
      return [`restriction:${p.restrictionId as string}`];
    case PROFILE_EVENT.preferenceSaved:
    case PROFILE_EVENT.preferenceRemoved:
      return [`preference:${p.preferenceId as string}`];
    case CHANGESET_REVERTED:
      return Object.keys((event.payload as ChangesetRevertedPayload).restore);
    default:
      return [];
  }
}

export function getProfileEntity(state: ProfileState, key: string): ProfileEntity | null {
  const { kind, id } = splitEntityKey(key);
  if (kind === "restriction") return state.restrictions[id] ?? null;
  if (kind === "preference") return state.preferences[id] ?? null;
  return null;
}

const stamp = (e: EventEnvelope) => ({ updatedAt: e.recordedAt, updatedBy: e.actor });
const created = (e: EventEnvelope): AuditFields => ({
  createdAt: e.recordedAt,
  createdBy: e.actor,
  updatedAt: e.recordedAt,
  updatedBy: e.actor,
});

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  const next = { ...record };
  delete next[id];
  return next;
}

/** Pure: the profile state after one event. Unknown event types are ignored (forward compatible). */
export function applyProfileEvent(state: ProfileState, event: EventEnvelope): ProfileState {
  switch (event.type) {
    case PROFILE_EVENT.restrictionAdded: {
      const p = event.payload as RestrictionAddedPayload;
      const r: Restriction = compact({
        id: p.restrictionId,
        userId: p.userId,
        kind: p.kind,
        subject: p.subject,
        subjectKey: p.subjectKey,
        note: p.note,
        ...created(event),
      });
      return { ...state, restrictions: { ...state.restrictions, [r.id]: r } };
    }
    case PROFILE_EVENT.restrictionUpdated: {
      const p = event.payload as RestrictionUpdatedPayload;
      const prev = state.restrictions[p.restrictionId];
      if (!prev) return state;
      const next: Restriction = compact({ ...prev, note: p.note ?? undefined, ...stamp(event) });
      return { ...state, restrictions: { ...state.restrictions, [next.id]: next } };
    }
    case PROFILE_EVENT.restrictionRemoved: {
      const p = event.payload as RestrictionRemovedPayload;
      return { ...state, restrictions: without(state.restrictions, p.restrictionId) };
    }
    case PROFILE_EVENT.preferenceSaved: {
      const p = event.payload as PreferenceSavedPayload;
      const pref: Preference = {
        id: p.preferenceId,
        userId: p.userId,
        statement: p.statement,
        statementKey: p.statementKey,
        confirmedByMessageId: p.confirmedByMessageId,
        ...created(event),
      };
      return { ...state, preferences: { ...state.preferences, [pref.id]: pref } };
    }
    case PROFILE_EVENT.preferenceRemoved: {
      const p = event.payload as PreferenceRemovedPayload;
      return { ...state, preferences: without(state.preferences, p.preferenceId) };
    }
    case CHANGESET_REVERTED: {
      const p = event.payload as ChangesetRevertedPayload<ProfileEntity>;
      let next = state;
      for (const [key, value] of Object.entries(p.restore)) {
        const { kind, id } = splitEntityKey(key);
        if (kind === "restriction") {
          next = {
            ...next,
            restrictions: value
              ? { ...next.restrictions, [id]: { ...(value as Restriction), ...stamp(event) } }
              : without(next.restrictions, id),
          };
        } else if (kind === "preference") {
          next = {
            ...next,
            preferences: value
              ? { ...next.preferences, [id]: { ...(value as Preference), ...stamp(event) } }
              : without(next.preferences, id),
          };
        }
      }
      return next;
    }
    default:
      return state;
  }
}

export function replayProfile(events: EventEnvelope[], initial: ProfileState = emptyProfileState()): ProfileState {
  return events.reduce(applyProfileEvent, initial);
}
