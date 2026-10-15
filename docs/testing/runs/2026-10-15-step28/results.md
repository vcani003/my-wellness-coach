# Re-check of step 28 (single), 2026-10-15

Target: local preview of the main working tree (uncommitted fix), `http://localhost:3100` (port 3000 left alone), stand-in AI, demo kitchen, acting as Vero, reset first. Driven with Playwright like a user: "I bought eggs" twice → tap **Those are gone** → reload → Undo.

| # | Check | Phone 375×812 | Desktop 1280×800 |
|---|---|---|---|
| 1 | Before reload: repeat-eggs receipt shows "Eggs: those are gone (1 batch left)", one Undo labelled "Undo: Eggs: those are gone (1 batch left)" | Pass (phone-01) | Pass (desktop-01) |
| 2 | After reload: same line and same Undo label, exactly as before | Pass: "Added eggs (2 batches) · Eggs: those are gone (1 batch left) · Undo" (phone-02) | Pass; the first "Added eggs" receipt is also still there (desktop-02) |
| 3 | Tap that Undo after reload → "gone" answer undone, choice comes back | Pass: "You also had eggs from Oct 15." with **Still have them · Those are gone**; Undo now "Undo: Added eggs (2 batches)"; Kitchen row "Eggs · 2 batches · oldest added today" (phone-03) | Pass (desktop-03) |
| 4 | Console: no "Maximum update depth exceeded" | Pass (none) | Pass (none) |

**Step 28: Pass (4/4 checks at both sizes).**

Felt wrong (unchanged, already known): "You also had eggs from Oct 15." when that's today.
