# Plan: find and cook past recipes again (Recipe box, narrowed)

**Status:** Proposed · 2026-10-15 · Orchestrator. Questions RB1–RB9 in OPEN-QUESTIONS.

## Today
- Every meal and every recipe version is saved per kitchen, and Done records when it was cooked.
- The cooked version is "the newest version at Done". That's implied: nothing records it, and nothing stops a later change.
- **You can't find a past recipe:** Done meals drop off the Meal plan, there's no history list, and search covers kitchen items only.
- **Chat can't see past meals:** "make that curry again" writes a brand-new recipe.
- Allergy flags are recomputed from today's allergies whenever a recipe is shown.

## MVP pieces (in order)
| # | Piece | Size | Owner |
|---|---|---|---|
| A1 | Past-meals query: Done meals, newest first, search by name or ingredient (accent-insensitive, as 0032) | S | Backend |
| A2 | Lock Done meals: no new recipe versions after Done, so the newest version is the cooked one | S | Backend |
| A3 | "Cooked before" list with search in the Meals area (0034), and a read-only recipe view with "Make again" | M | UX → Frontend |
| C | "Make again": a new meal whose v1 copies the cooked version; refine as usual; the old meal is never touched; allergies re-checked | M | Backend + Frontend |
| B1 | Naming a dish you've made offers "the one from 15 Oct, or a new one?" (code matches titles, so nothing is invented) | S–M | AI + Backend |
| B2 | "What did we make last week?" answered from a short list of past meals; dates come from code | M | AI |

## Risks
- **Prompt size:** at most about 20 past titles, interpreter only.
- **Allergies added since:** always flagged, with a one-tap "make it without X". Diets have no word list yet.
- **Two matches** ("the curry"): ask "Which one?".
- **Pasted recipes stay data,** never instructions.
- **Search runs as a database query,** not a load of all history.
