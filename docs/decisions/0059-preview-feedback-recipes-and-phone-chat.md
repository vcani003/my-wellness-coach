# 0059: Preview feedback: recipe amounts, recipe questions, phone chat, stand-in AI label

**Status:** Accepted · 2026-10-17 · Decided by Vero (PF1–PF5, PF8–PF10: "go with recs"; PF6 and PF7 in her own words). Amends [0017](0017-shared-kitchen-and-layout.md) UX3 (the dock's default on phone).

Context: in the 2026-10-17 local preview, a Japanese rolled omelette recipe came with no amounts and generic steps. A question about the measurements removed ingredients. On her phone, messages didn't send, and chat was open at launch. The preview ran the stand-in AI.

- **PF1. Every recipe ingredient has an amount,** except pantry basics used "to taste" (salt, pepper, oil). Amounts fit the servings shown. Enforced by the recipe prompt and checked by an eval.
- **PF2. A question about a recipe ("how much do I need?", "what are the measurements?") is answered in chat and changes nothing:** no kitchen or list change and no new recipe version. This is a model rule plus a code guard (a question never removes items), with evals.
- **PF3. On phone, chat starts Minimized at launch** (only the chat button shows) and opens when tapped. Desktop is unchanged. The ux.md line "Peek (default)" changes to match.
- **PF4. The combined branch becomes a working branch,** `feat/kitchen-os-next` (the Kitchen OS stack plus idea-refine). Fixes are built on it. It is not merged into ui/kitchen-os until Vero says so.
- **PF5. Previews use the real AI** (the staging key) whenever its budget allows.
- **PF6. When the stand-in AI is answering, the app says so on screen.** Vero: "Just make it apparent when its a stand in ai."
- **PF7. Phone chat is tested with a real phone keyboard,** not only desktop Chrome with Enter. Vero: "You should be testing real phone capability with keyboard."
- **PF8. A missing amount isn't written into the recipe** when someone asks about it. It is answered in chat only, as in PF2.
- **PF9. When a removal is skipped because it was asked as a question,** Lumi says: "I didn't change anything, since that sounded like a question. Tell me if you meant it as a change."
- **PF10. The stand-in AI only does simple kitchen updates:** bought, used, froze, running low, Out, undo, staples, and plan for a day. For questions, recipes, meal ideas and recipe changes it replies "That needs the real AI (Claude). I'm only the stand-in." and changes nothing. "Make me a sample recipe" gives a recipe titled "Sample recipe (stand-in)", so recipe and week-plan screens can still be clicked through. Recipe quality and questions are tested only with the real AI. Vero: "stand in ai shouldnt be able to answer. only the real model can."
- **PF11. The item edit sheet opens with a soft spring bounce** (phone: it slides up; desktop: it pops in), and the tapped food tile squishes slightly. Reduced motion gets a plain fade. This is an exception to [0046](0046-bright-look.md)'s "overshoot for Lumi and celebrations only". It is kept as separate motion tokens, so it is easy to remove. Vero: "can you recreate a smoother transition or even something fun like a bounce?"
