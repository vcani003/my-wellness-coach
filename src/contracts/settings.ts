/**
 * Settings (P2 b, 0015, 0017, 0019): what the Settings page reads, and the data-control
 * constants (backend-data.md §6, §7). Pure: no server-only imports.
 */
import { z } from "zod";
import { ActorRef, Id, RestrictionKind } from "./common";

const isoDate = z.iso.datetime({ offset: true });

/**
 * One of your allergies or diets, with provenance (AI7). `verified` is false while it was added
 * by another member and you haven't confirmed it: show "Added by {addedBy}" and Keep / Remove.
 */
export const SettingsRestriction = z.object({
  id: Id,
  kind: RestrictionKind,
  subject: z.string(),
  /** Your own words (0019), shown back as said. */
  note: z.string().optional(),
  addedBy: ActorRef,
  addedAt: isoDate,
  /** True when `addedBy` is you. */
  addedByYou: z.boolean(),
  verified: z.boolean(),
  verifiedAt: isoDate.optional(),
});
export type SettingsRestriction = z.infer<typeof SettingsRestriction>;

/** A lasting preference you said yes to remembering (0012). */
export const SettingsPreference = z.object({
  id: Id,
  statement: z.string(),
  savedAt: isoDate,
});
export type SettingsPreference = z.infer<typeof SettingsPreference>;

export const SettingsView = z.object({
  me: z.object({ id: Id, name: z.string() }),
  /** Your kitchen (MVP 1: one per person, 0006); null if you're in none. */
  kitchen: z.object({ id: Id, name: z.string(), isTest: z.boolean(), version: z.number().int().nonnegative() }).nullable(),
  /** Everyone in that kitchen, you included, in the order they joined. */
  members: z.array(z.object({ id: Id, name: z.string(), isYou: z.boolean() })),
  /** Allergies first, then diets; oldest first within each. */
  restrictions: z.array(SettingsRestriction),
  preferences: z.array(SettingsPreference),
});
export type SettingsView = z.infer<typeof SettingsView>;

/**
 * `POST /api/me/delete` needs this exact phrase as `{ confirm }` (case and outer spaces ignored),
 * so a stray request or a mis-tap can't delete anything. The UI sends it once the person confirms.
 */
export const DELETE_CONFIRMATION_PHRASE = "delete my data";
export const DeleteRequest = z.object({ confirm: z.string().max(100) });

/** What `GET /api/me/export` downloads: one JSON file. `format` + `version` make it self-describing. */
export const EXPORT_FORMAT = "kitchen-assistant-export";
export const EXPORT_VERSION = 1;
