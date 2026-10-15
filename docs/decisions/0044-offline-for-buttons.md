# 0044: Offline for buttons; chat stays online

**Status:** Accepted · 2026-10-15 · Decided by Vero (KOS7). Supersedes [0017](0017-shared-kitchen-and-layout.md) "Offline is read-only in MVP 1".

- **Button actions work offline.** These are the actions on the list, items and plan.
  - The change shows at once and waits in a queue.
  - When you're back online, it's sent, and the server checks it as usual.
  - If the server refuses it, the reason shows in place, the same way a shopping tick is put back today.
- **Chat and AI stay online-only.** Send is off while offline. Pending changes are sent before the next chat message, so the assistant sees the latest kitchen.
- **Why not fully offline-first (like recipe-cat):**
  - It's about 4–6 milestones of rework: kitchen logic running on the phone, phone-made IDs, merging, undo, receipts, and allergy flags.
  - It brings real risks: allergy flags could be stale, duplicate items, unsent changes lost when Safari clears storage, and "Sign out everywhere" can't reach an offline phone.
  - Buttons offline already covers the in-store case. The first real test is a grocery trip (0026).
  - It can be reconsidered after real use.
- **How:** extend the existing tick queue (`src/ui/widgets/shopping/tick-queue.ts`). The app still needs a service worker and a cached app shell, which are not built yet.
