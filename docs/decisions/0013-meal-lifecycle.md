# 0013 — Choosing, cooking and finishing meals

**Status:** Accepted · 2026-10-13 (lifecycle approved 2026-10-14) · Decided by Vero
Full design: [ux.md](../architecture/ux.md) §3 and §5.

## Lifecycle (M5, approved as written)
1. **Idea:** a card in Meal ideas. Not saved as a meal.
2. **Chosen:** tap "Choose" or name it in chat. Choosing counts as confirming, and the recipe opens.
3. **In plan:** "Add to plan" is separate and optional.
4. **Cooking:** "Start cooking", with or without planning first. **Several meals can be cooking at once.**
5. **Done / Cancelled:** cancelling never changes the kitchen, and it has Undo.

- **One home:** the Meal plan list holds planned *and* cooking meals, with cooking ones first.
- **"Add that":** the most recently chosen meal, or "Which one?" if that's unclear.
- **Recipes (R1, R2):** choosing a meal opens an **AI-suggested recipe by default** (labelled as a suggestion), with a **"Use my own recipe"** link to paste or type your own instead. Refine it in chat ("no oven", "make it spicier"). There's no question each time.

## Ingredient checklist (M2, M6)
- One list per recipe, labelled **In your kitchen** / **Need**. Ticking ≠ buying.
- **Ticks are shared** by everyone in the kitchen (M6). Who ticked is shown.
- **"Add to your kitchen?"** sheet: ticked "Need" items are pre-selected. It offers Select all / Unselect all, **Add**, **Skip** and **Do later**. An "add more context" field is deferred to the next MVP.

## After cooking (M4, M7)
- Finishing a meal records that its ingredients were **used in that meal**.
- **"Update your kitchen" step (M8, approved):** under "Cooked: <meal>", each ingredient the meal used gets one choice: **Still have some** (default, nothing changes), **Running low**, or **Out**. Nothing is pre-selected beyond the default. An optional note, "Anything to remember about what you used?", is saved with that cooking session. Then **Done**, **Skip** or **Do later**.
- **Skip** records the ingredients as "used in this meal, amount unknown".
- This step is required but **skippable** or **do later**.
- **"Do later"** items wait in **To review** at the top of the Kitchen widget.
- **No reserving** ingredients when planning (0008).
