/**
 * Settings view models (ux.md §7; 0015, 0019 AI7). Pure: no React, no server imports, so the
 * server page, the client screen and the tests share them.
 */
import type { ApplyResult } from "@/contracts/apply-result";
import type { ActorRef, Msg } from "@/contracts/common";
import type { SettingsRestriction, SettingsView } from "@/contracts/settings";

/** The Allergies and preferences heading: the home banner links straight to it. */
export const REMEMBER_HEADING_ID = "settings-remember";

/** One of your allergies or diets that another member added and you haven't confirmed (AI7). */
export interface PendingConfirm {
  id: string;
  kind: SettingsRestriction["kind"];
  subject: string;
  addedBy: ActorRef;
}

export function pendingConfirms(view: SettingsView | null): PendingConfirm[] {
  if (!view) return [];
  return view.restrictions
    .filter((r) => !r.verified && !r.addedByYou)
    .map((r) => ({ id: r.id, kind: r.kind, subject: r.subject, addedBy: r.addedBy }));
}

/**
 * Another member's allergies and diets, read-only for you (0019: every member's allergies are
 * considered, so members can see them; only the owner can change them). Their preferences stay theirs.
 */
export interface MemberRestrictions {
  member: { id: string; name: string };
  restrictions: {
    id: string;
    kind: SettingsRestriction["kind"];
    subject: string;
    note?: string;
    addedBy: ActorRef;
    /** True when the member added it themselves. */
    addedByOwner: boolean;
    verified: boolean;
  }[];
}

/** Keep only what you may see of another member's view: their allergies and diets. */
export function toMemberRestrictions(member: { id: string; name: string }, view: SettingsView | null): MemberRestrictions {
  return {
    member,
    restrictions: (view?.restrictions ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      subject: r.subject,
      ...(r.note ? { note: r.note } : {}),
      addedBy: r.addedBy,
      addedByOwner: r.addedByYou,
      verified: r.verified,
    })),
  };
}

/** The server actions Settings uses (`src/app/settings/actions.ts`); tests pass fakes. */
export interface SettingsActions {
  load(): Promise<SettingsView | null>;
  verify(input: { tapId: string; restrictionId: string }): Promise<SettingsTapResult>;
  remove(input: { tapId: string; restrictionId: string }): Promise<SettingsTapResult>;
  signOut(): Promise<void>;
  signOutEverywhere(): Promise<void>;
}

export type SettingsTapResult =
  | { ok: true; result: ApplyResult; settings: SettingsView | null }
  | { ok: false; reason: Msg; retryable: boolean };

/**
 * Session-only "Not now" on the home banner: kept in sessionStorage (this tab's session), with an
 * in-memory copy so it still works when storage is blocked (0018). Read through
 * `useSyncExternalStore` (`subscribeDismissed` + `dismissedSnapshot`).
 */
const DISMISSED_KEY = "settings.confirmDismissed";
let dismissedMemory: string | null = null;
const dismissedListeners = new Set<() => void>();

export function subscribeDismissed(listener: () => void): () => void {
  dismissedListeners.add(listener);
  return () => dismissedListeners.delete(listener);
}

/** The raw JSON (a stable string, as useSyncExternalStore needs). */
export function dismissedSnapshot(): string {
  if (dismissedMemory !== null) return dismissedMemory;
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function parseDismissed(raw: string | null): string[] {
  try {
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeDismissed(ids: string[]): void {
  dismissedMemory = JSON.stringify(ids);
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, dismissedMemory);
  } catch {
    // Private mode or blocked storage: the in-memory copy lasts until the page reloads.
  }
  for (const listener of dismissedListeners) listener();
}

/** Tests only: forget the in-memory copy. */
export function resetDismissedForTests(): void {
  dismissedMemory = null;
}

/** On sign-out and delete: nothing of yours stays on this phone (frontend.md §5). */
export function clearDeviceData(): void {
  dismissedMemory = null;
  for (const store of ["localStorage", "sessionStorage"] as const) {
    try {
      window[store].clear();
    } catch {
      // Storage blocked: nothing was kept there anyway.
    }
  }
}
