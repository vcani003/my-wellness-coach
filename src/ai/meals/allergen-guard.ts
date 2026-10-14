/**
 * The code lock on allergies for ideas and recipes (ai.md §6, 0019, AI6, 0025). The model is told
 * the rules too, but these decide:
 * - Flags come from the shared word list (`computeAllergenFlags`), never from the model.
 * - An unprompted idea containing any member's allergen is left out, unless that allergy is
 *   "excused" for it:
 *   - asked for: the user's own typed words hit the same allergy ("shrimp tacos?"), or
 *   - use it up: the idea uses a kitchen item that needs using up and is itself that allergen
 *     (0025: still suggested, flagged).
 * - Anything kept is always flagged. No medical advice is ever added here.
 */
import type { AllergenFlag } from "@/contracts/common";
import { computeAllergenFlags } from "@/shared/profile/allergens";
import type { Restriction } from "@/shared/profile/state";

const key = (f: Pick<AllergenFlag, "userId" | "subject">) => `${f.userId}|${f.subject.toLowerCase()}`;

export function flagsFor(names: string[], restrictions: Restriction[]): AllergenFlag[] {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  return clean.length ? computeAllergenFlags(clean, restrictions) : [];
}

/** Allergies the user's own typed words ask for. Pasted text never counts (it isn't typed). */
export function askedAllergies(text: string | null | undefined, restrictions: Restriction[]): Set<string> {
  if (!text?.trim()) return new Set();
  return new Set(flagsFor([text], restrictions).map(key));
}

export interface IdeaAllergenCheck {
  flags: AllergenFlag[];
  keep: boolean;
}

/**
 * Flags for an idea, and whether it may be shown.
 * `usedNames` are the kitchen items it uses; `useItUpNames` the subset that needs using up.
 */
export function checkIdea(
  idea: { name: string; usedNames: string[]; useItUpNames: string[]; missing: string[] },
  restrictions: Restriction[],
  asked: Set<string>,
): IdeaAllergenCheck {
  const flags = flagsFor([idea.name, ...idea.usedNames, ...idea.missing], restrictions);
  if (flags.length === 0) return { flags, keep: true };
  const excused = new Set([...asked, ...flagsFor(idea.useItUpNames, restrictions).map(key)]);
  return { flags, keep: flags.every((f) => excused.has(key(f))) };
}

/** Plain lines for the prompt: whose allergy, and their own note, as said (0019). */
export function restrictionLines(
  restrictions: Restriction[],
  members: Array<{ userId: string; name: string }>,
  askerId: string,
): string[] {
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? "A member";
  return restrictions
    .filter((r) => r.kind === "allergy" || r.userId === askerId)
    .map((r) => {
      const who = nameOf(r.userId);
      const what = r.kind === "allergy" ? `${who}: allergic to ${r.subject.value}` : `${who} (asking): diet ${r.subject.value}`;
      return r.note?.value ? `${what}. Their own note: "${r.note.value}"` : what;
    });
}
