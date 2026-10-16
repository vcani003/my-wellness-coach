# 0058: Week plan details (KOS1, KOS12)

**Status:** Accepted · 2026-10-16 · Decided by Vero (KOS1-a to KOS1-d: "go with recs"). Refines [0045](0045-kitchen-os-features.md) KOS1/KOS12 and reopens [0008](0008-meal-plan-depth.md) as KOS1 said.

- **Dates are calendar days in the person's own time zone.** The window runs from yesterday to 21 days ahead, and undated meals still work. Days are resolved by code from the message date, never by the model.
- **KOS1-a. "The week's needs" includes undated planned meals by default**, because every existing plan is undated. The sheet can offer a "Dated only" toggle.
- **KOS1-b. "Next Tuesday" means the coming Tuesday,** or a week later if today is Tuesday. A plain "Tuesday" can include today. A vague day ("next week") gets "Which day?".
- **KOS1-c. The week view is a rolling 7 days from today**, not Monday to Sunday.
- **KOS1-d. KOS12 adds use a staple's usual store later, with KOS9 (aisles).** Not now.
- **KOS1-e. While no meal has a day,** "No day yet" comes first, with a hint to pick a day. Once any meal has a day, the week comes first and "No day yet" moves to the end.
- **KOS1-f. An empty plan keeps the calm empty card,** with no empty week and no ingredients button.

KOS1-e and KOS1-f: Vero, "go with recs", 2026-10-16.
