/**
 * What the meal screens know for this session only (0013): the latest meal ideas (not saved, gone
 * next session), recipes as they stream in, and the "Update your kitchen" sheet waiting to open.
 * One pure reducer, fed by the turn stream (`/api/chat` and `/api/meals/choose`, backend §6).
 * Saved meals, the plan and ticks come from KitchenState, never from here.
 *
 * Each stream has a key (the chat message ID or the Choose tap ID), so when one stream ends only
 * its own unfinished parts are dropped.
 */
import { z } from "zod";
import { AllergenFlag, Msg } from "@/contracts/common";
import type { MealIdea, StreamEvent, UpdateKitchenPrompt } from "@/contracts/stream";

export type IdeaCard = MealIdea;

export interface IdeaSet {
  /** null while "Finding ideas…" before the first card. */
  setId: string | null;
  key: string;
  basedOnVersion: number;
  ideas: IdeaCard[];
  /** e.g. the assumed-basics reminder (BASICS_ASSUMED). */
  notes: Msg[];
  status: "loading" | "streaming" | "ready";
}

export type IngredientGroup = "kitchen" | "need" | "basic";

export interface RecipeIngredient {
  index: number;
  name: string;
  amount?: string;
  itemId?: string;
  group: IngredientGroup;
  allergenFlags: AllergenFlag[];
}

export interface RecipeDraft {
  mealId: string;
  key: string;
  title?: string;
  summary?: string;
  source?: "ai" | "user";
  allergenFlags: AllergenFlag[];
  ingredients: RecipeIngredient[];
  steps: string[];
  basics: string[];
  basicsNote: Msg | null;
  /** writing → saved (`recipe.saved`), or failed (the stream ended without saving: parts dropped). */
  status: "writing" | "saved" | "failed";
  version?: number;
  /**
   * A refinement applied in place (`edit` part): positions of the lines it added or changed, for
   * a brief highlight. Absent for a recipe written from scratch.
   */
  changed?: { ingredients: number[]; steps: number[] };
  /** What was shown before an `edit` part, put back if that edit is never saved. */
  previous?: RecipeDraft | null;
}

export interface UpdateKitchenRequest extends UpdateKitchenPrompt {
  /** Set when reopened from a To review card: Done/Skip then close that card. */
  reviewId?: string;
}

export interface MealsSession {
  ideas: IdeaSet | null;
  /** Idea cards whose Choose is in flight, or failed (with a plain error on the card). */
  choosing: Record<string, "choosing" | "failed">;
  recipes: Record<string, RecipeDraft>;
  updateKitchen: UpdateKitchenRequest | null;
  /** What the last stream event per key was about, so `notes` land in the right place. */
  lastKind: Record<string, { kind: "ideas" } | { kind: "recipe"; mealId: string }>;
}

export const initialMealsSession: MealsSession = { ideas: null, choosing: {}, recipes: {}, updateKitchen: null, lastKind: {} };

export type MealsEvent =
  | { type: "stream"; key: string; event: StreamEvent }
  /** The stream ended (`done`, `error` or cut): unsaved recipe parts are dropped (backend §6). */
  | { type: "streamEnded"; key: string }
  /** A recipe is on its way for this meal ("Writing your recipe…" before its first part). */
  | { type: "recipeExpected"; mealId: string; key: string }
  | { type: "chooseStart"; ideaId: string }
  | { type: "chooseFailed"; ideaId: string }
  | { type: "chooseDone"; ideaId: string }
  | { type: "openUpdateKitchen"; request: UpdateKitchenRequest }
  | { type: "closeUpdateKitchen" };

// `recipe` part data is owned by the AI specialist (ai.md §5); checked here, dropped if it doesn't fit (0018).
const Meta = z.object({
  title: z.string(),
  summary: z.string().optional().default(""),
  source: z.enum(["ai", "user"]).optional(),
  allergenFlags: z.array(AllergenFlag).optional().default([]),
});
const Ingredient = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1),
  amount: z.string().nullish(),
  itemId: z.string().nullish(),
  group: z.enum(["kitchen", "need", "basic"]),
  allergenFlags: z.array(AllergenFlag).optional().default([]),
});
const Step = z.object({ index: z.number().int().nonnegative(), text: z.string() });
const Basics = z.object({ basics: z.array(z.string()), note: Msg.nullish() });
const Edit = z.object({
  title: z.string(),
  summary: z.string().optional().default(""),
  source: z.enum(["ai", "user"]).optional(),
  allergenFlags: z.array(AllergenFlag).optional().default([]),
  ingredients: z.array(Ingredient.omit({ index: true })),
  steps: z.array(z.string()),
  basics: z.array(z.string()).optional().default([]),
  note: Msg.nullish(),
  changed: z.object({ ingredients: z.array(z.number().int()), steps: z.array(z.number().int()) }),
});

/**
 * A refinement applied as edits: the whole new recipe replaces the shown one in place (nothing
 * blanks), with the changed lines marked. The shown version is kept so an unsaved edit can be undone.
 */
function editDraft(existing: RecipeDraft | undefined, mealId: string, key: string, data: unknown): RecipeDraft | null {
  const e = Edit.safeParse(data);
  if (!e.success) return null;
  const d = e.data;
  const previous = existing && existing.key !== key ? { ...existing, previous: null } : (existing?.previous ?? null);
  return {
    mealId,
    key,
    title: d.title,
    summary: d.summary,
    source: d.source,
    allergenFlags: d.allergenFlags,
    ingredients: d.ingredients.map((i, index) => ({
      index,
      name: i.name,
      group: i.group,
      allergenFlags: i.allergenFlags,
      ...(i.amount ? { amount: i.amount } : {}),
      ...(i.itemId ? { itemId: i.itemId } : {}),
    })),
    steps: d.steps,
    basics: d.basics,
    basicsNote: d.note ?? null,
    status: "writing",
    changed: d.changed,
    previous,
  };
}

function emptyDraft(mealId: string, key: string): RecipeDraft {
  return { mealId, key, allergenFlags: [], ingredients: [], steps: [], basics: [], basicsNote: null, status: "writing" };
}

function recipePart(draft: RecipeDraft, part: string, data: unknown): RecipeDraft {
  switch (part) {
    case "meta": {
      const m = Meta.safeParse(data);
      if (!m.success) return draft;
      return { ...draft, title: m.data.title, summary: m.data.summary, source: m.data.source, allergenFlags: m.data.allergenFlags };
    }
    case "ingredient": {
      const i = Ingredient.safeParse(data);
      if (!i.success) return draft;
      const next: RecipeIngredient = {
        index: i.data.index,
        name: i.data.name,
        group: i.data.group,
        allergenFlags: i.data.allergenFlags,
        ...(i.data.amount ? { amount: i.data.amount } : {}),
        ...(i.data.itemId ? { itemId: i.data.itemId } : {}),
      };
      const ingredients = [...draft.ingredients.filter((x) => x.index !== next.index), next].sort((a, b) => a.index - b.index);
      return { ...draft, ingredients };
    }
    case "step": {
      const s = Step.safeParse(data);
      if (!s.success) return draft;
      const steps = [...draft.steps];
      steps[s.data.index] = s.data.text;
      return { ...draft, steps };
    }
    case "basics": {
      const b = Basics.safeParse(data);
      if (!b.success) return draft;
      return { ...draft, basics: b.data.basics, basicsNote: b.data.note ?? null };
    }
    default:
      return draft;
  }
}

function onStream(state: MealsSession, key: string, event: StreamEvent): MealsSession {
  switch (event.type) {
    case "status":
      if (event.phase !== "ideas") return state;
      // A new request replaces the old ideas (0013).
      return {
        ...state,
        ideas: { setId: null, key, basedOnVersion: 0, ideas: [], notes: [], status: "loading" },
        lastKind: { ...state.lastKind, [key]: { kind: "ideas" } },
      };
    case "idea": {
      const current = state.ideas;
      const same = current && (current.setId === event.setId || (current.setId === null && current.key === key));
      const base: IdeaSet = same
        ? current
        : { setId: event.setId, key, basedOnVersion: event.basedOnVersion, ideas: [], notes: [], status: "streaming" };
      if (base.ideas.some((i) => i.ideaId === event.idea.ideaId)) return state;
      return {
        ...state,
        ideas: { ...base, setId: event.setId, basedOnVersion: event.basedOnVersion, status: "streaming", ideas: [...base.ideas, event.idea] },
        lastKind: { ...state.lastKind, [key]: { kind: "ideas" } },
      };
    }
    case "ideas.dropped":
      return state.ideas?.setId === event.setId ? { ...state, ideas: null } : state;
    case "notes": {
      const last = state.lastKind[key];
      if (last?.kind === "ideas" && state.ideas?.key === key) return { ...state, ideas: { ...state.ideas, notes: event.notes } };
      return state; // a recipe's basics note arrives in its `basics` part
    }
    case "recipe": {
      const existing = state.recipes[event.mealId];
      if (event.part === "edit") {
        const edited = editDraft(existing, event.mealId, key, event.data);
        if (!edited) return state;
        return {
          ...state,
          recipes: { ...state.recipes, [event.mealId]: edited },
          lastKind: { ...state.lastKind, [key]: { kind: "recipe", mealId: event.mealId } },
        };
      }
      // A new stream for the meal (a full rewrite, or Try again) starts a fresh draft.
      let draft = existing && existing.key === key && existing.status === "writing" ? existing : emptyDraft(event.mealId, key);
      draft = recipePart(draft, event.part, event.data);
      return {
        ...state,
        recipes: { ...state.recipes, [event.mealId]: draft },
        lastKind: { ...state.lastKind, [key]: { kind: "recipe", mealId: event.mealId } },
      };
    }
    case "recipe.saved": {
      const draft = state.recipes[event.mealId];
      if (!draft) return state;
      return { ...state, recipes: { ...state.recipes, [event.mealId]: { ...draft, status: "saved", version: event.version, previous: null } } };
    }
    case "update-kitchen":
      return { ...state, updateKitchen: { mealId: event.mealId, title: event.title, items: event.items } };
    default:
      return state;
  }
}

export function mealsReducer(state: MealsSession, event: MealsEvent): MealsSession {
  switch (event.type) {
    case "stream":
      return onStream(state, event.key, event.event);
    case "streamEnded": {
      const recipes = { ...state.recipes };
      let changed = false;
      for (const [mealId, d] of Object.entries(recipes)) {
        if (d.key === event.key && d.status === "writing") {
          changed = true;
          if (d.changed) {
            // An edit that wasn't saved: the recipe is as it was (the chat reply says so).
            if (d.previous) recipes[mealId] = d.previous;
            else delete recipes[mealId];
            continue;
          }
          // No `recipe.saved` by the end: those parts weren't saved, so they go (backend §6).
          recipes[mealId] = { ...emptyDraft(mealId, d.key), title: d.title, status: "failed" };
        }
      }
      let ideas = state.ideas;
      if (ideas?.key === event.key) {
        ideas = ideas.ideas.length ? { ...ideas, status: "ready" } : null;
        changed = true;
      }
      const { [event.key]: _gone, ...lastKind } = state.lastKind;
      return changed || _gone ? { ...state, recipes, ideas, lastKind } : state;
    }
    case "recipeExpected": {
      const existing = state.recipes[event.mealId];
      if (existing?.key === event.key) return state;
      return { ...state, recipes: { ...state.recipes, [event.mealId]: emptyDraft(event.mealId, event.key) } };
    }
    case "chooseStart":
      return { ...state, choosing: { ...state.choosing, [event.ideaId]: "choosing" } };
    case "chooseFailed":
      return { ...state, choosing: { ...state.choosing, [event.ideaId]: "failed" } };
    case "chooseDone": {
      const choosing = { ...state.choosing };
      delete choosing[event.ideaId];
      return { ...state, choosing };
    }
    case "openUpdateKitchen":
      return { ...state, updateKitchen: event.request };
    case "closeUpdateKitchen":
      return state.updateKitchen ? { ...state, updateKitchen: null } : state;
  }
}
