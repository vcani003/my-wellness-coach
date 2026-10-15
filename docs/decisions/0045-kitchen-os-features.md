# 0045: Kitchen OS features (KOS1–KOS16)

**Status:** Accepted · 2026-10-15 · Decided by Vero: all recs, except KOS10 (the assistant is Lumi). Built one milestone per feature, after the UI swap ([0043](0043-scope-from-kitchen-os.md)). "Port" means reusing recipe-cat's pure code.

| ID | Decision | Changes |
|---|---|---|
| KOS1 | **Dated week plan.** Planned meals get an optional date, and the undated list still works. Port recipe-cat's date helpers and its plan window (yesterday to 21 days ahead) | 0008 |
| KOS2 | **Estimated use-by per batch**, from shelf life in a food catalog. It's marked "est.", can be changed in one tap, and feeds "Use it up" and "Use soon". Port recipe-cat's food catalog and freshness helpers | 0025 |
| KOS3 | **Tap an item to edit it.** The item actions from 0030/0036 become button actions, and See all becomes editable | 0017 |
| KOS4 | **Stock levels plenty / some / low / out** | 0011 |
| KOS5 | **Favorites in the recipe box**, and AI-written recipes are kept there. No starter set | 0040 |
| KOS6 | **History tab:** a read-only household change log. Undo still covers only your own changes | none |
| KOS7 | **Offline for buttons**, see [0044](0044-offline-for-buttons.md) | 0017 |
| KOS8 | **The assistant can move the screen and suggest reply chips** (new `view` and `chips` stream events) | none |
| KOS9 | **Shopping list grouped by aisle** (from the food catalog) when no store was said. The row's "why" comes from its source | 0027 |
| KOS10 | **The assistant is Lumi, a cat (she/her).** She is the voice in chat and the mascot. "Kitchen" stays the name of the Kitchen place and assistant area | 0020, 0035 |
| KOS11 | **Household:** invite links stay (0029); add rename yourself and leave | 0029 |
| KOS12 | **"Add the week's missing ingredients to the list"** | none |
| KOS13 | **Cooking keeps "Update your kitchen"** (0013), restyled as Kitchen OS cook steps | none |
| KOS14 | **Dark theme in MVP 1** | 0017 |
| KOS15 | **One colour reserved for allergy flags** in the new palette | 0024 |
| KOS16 | **Chat asks before removing more than 5 things at once** (ported from recipe-cat) | none |
