/**
 * The shared profile's interface for every domain (backend-data.md §5): allergies and diets
 * (with the person's own note, 0019) and lasting preferences (0012).
 */
import type { Queryable } from "@/db/client";
import { loadProfiles } from "./store";
import type { Preference, Restriction } from "./state";

export interface Profile {
  userId: string;
  restrictions: Restriction[];
  preferences: Preference[];
}

export async function getProfile(db: Queryable, userId: string): Promise<Profile> {
  const state = await loadProfiles(db, [userId]);
  return {
    userId,
    restrictions: Object.values(state.restrictions),
    preferences: Object.values(state.preferences),
  };
}
