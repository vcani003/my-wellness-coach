# After today's grocery run: checklist

Live app: **https://my-wellness-coach-mu.vercel.app** · Local copy (new work, not live): **http://localhost:3000** on your Mac
Tick things off as you go, and jot a word next to anything that felt off. "Felt off" is as useful as "broken".

---

## 1. Live app: today's test (decision 0026)

### Sign in
- [ ] The new login page loads and looks right on your phone
- [ ] Your passphrase works (the part *after* `vero=`), and Show/Hide helps
- [ ] You're still signed in after closing and reopening the browser
- [ ] *(Optional)* Safari → Share → **Add to Home Screen**, then sign in once more inside the home-screen app

### The shopping list
- [ ] Send: *"Add pho noodles to my list, plus garlic, ginger, green onion, shallot, culantro, lemongrass, sweet potato and coconut milk from MD Oriental, and oat milk from Publix"*
- [ ] The list shows **MD Oriental** and **Publix** groups, with **ginger only once**
- [ ] "What changed" lists what was added, and **Undo** works (then re-send if you undid it)
- [ ] *"What's on my list?"* answers grouped by store
- [ ] *"Move coconut milk to Publix"* moves it
- [ ] *"Take oat milk off the list"*, or ⋯ → **Remove**, removes it
- [ ] **At the store:** ticking is easy one-handed, and the big tick boxes are easy to hit
- [ ] **Bad signal?** Ticks show "Not synced yet" and then sync on their own
- [ ] **Done shopping** → "Add to your kitchen?" → ticked items are pre-selected → **Add** → they're in the Kitchen and off the list
- [ ] Note: **Do later** in that sheet only closes it on the live app. The proper version is built but not deployed yet.

### Unpacking at home
- [ ] One message with everything else you bought, using Vietnamese names however you normally say them
- [ ] Anything that was on the list leaves the list when you say you bought it (SL5)
- [ ] *"I froze the beef"* (or whatever you froze) moves it to **Freezer**
- [ ] *"What do I have?"* matches reality
- [ ] *"What staples do I still need?"* (for next time) gives a sensible answer grouped by store
- [ ] Fix one mistake in chat ("no, the … is in the pantry") and check the fix sticks

### Did it reflect your pantry?
- [ ] Kitchen widget ≈ what's actually in your fridge, freezer and pantry
- [ ] Anything it got wrong: ____________________

### Cost check
- [ ] [platform.claude.com](https://platform.claude.com) → Usage: today's spend should be roughly **$1–2**
- [ ] The **$10 monthly limit** is set (Settings → Limits)

### The verdict
- [ ] **Was the app meaningful today?** Yes / Somewhat / No. Why: ____________________
- [ ] The one thing that would have helped most: ____________________

---

## 2. Tonight: Levi joins (about 5 minutes)
- [ ] In Terminal, in the `my-wellness-coach` folder:
  ```bash
  npx vercel env rm ACCESS_CODES production
  ```
  ```bash
  npx vercel env add ACCESS_CODES production
  ```
  When asked, type **`vero=<your passphrase>,levi=<his passphrase>`**: both, comma-separated, each at least 12 characters, no commas inside them
- [ ] Tell Claude **"Levi's code is in"**, and Claude redeploys
- [ ] Levi signs in on his phone with his passphrase
- [ ] Levi asks *"Do we have fish sauce?"* and gets the right answer
- [ ] Levi changes something (*"I used the eggs"*), and on your screen it shows **"Levi · just now"** within about 15 seconds
- [ ] Levi can't Undo your changes, and you can't Undo his (you fix them in chat instead)

---

## 3. Being built now: check on your Mac at localhost:3000 (not live)
Uses a demo kitchen and the stand-in AI. The bar at the top switches between Vero and Levi.
- [x] **Chat history survives a reload** *(done, and checked by Claude)*
- [ ] **Meal ideas → recipe → meal plan → cooking → "Update your kitchen"** *(screens in progress)*
  - [ ] *"What can I make tonight?"* → about 3 idea cards, each with a "why"
  - [ ] **Allergen badge** (small, plum) on any seafood idea for Levi. Tap it to see his note.
  - [ ] **Choose** → the recipe opens, with "In your kitchen" / "Need" ticks (shared with Levi)
  - [ ] **Add Need items to shopping list**
  - [ ] **Add to plan** → **Start cooking** → **Done cooking**
  - [ ] **"Update your kitchen"**: *Still have some / Running low / Out*, plus a note
- [ ] **Settings** *(being built)*: privacy and terms pages, Sign out / **Sign out everywhere**, download your data, delete your data
- [ ] **Older and newer batches** *(queued)*: "Eggs · 2 batches", with the oldest used first

---

## 4. Waiting on you (any time)
- [ ] **AI9:** should "Low" items bring seafood dishes back into ideas? (Rec: no.) See [OPEN-QUESTIONS](../OPEN-QUESTIONS.md)
- [ ] **CL1 (b):** connect Vercel to GitHub (Vercel → Project → Settings → Git → Connect → `my-wellness-coach`), so Claude can work from the cloud with your Mac closed
- [ ] **For the test copy and tester agents (queued item e):** a second Neon project and a staging Anthropic workspace. Claude will give exact steps when it gets there.
- [ ] **GH1:** keep the GitHub repo private (Rec), or scrub the personal details first and make it public
- [ ] **Nov 10:** renew the Anthropic key ([runbook](../runbooks/renew-anthropic-key.md)). A reminder is scheduled.
