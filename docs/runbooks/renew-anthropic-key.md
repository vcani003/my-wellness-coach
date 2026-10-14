# Renew the Anthropic API key (every 30 days)

The key was created on **2026-10-14** with a **30-day expiry**, so it expires around **2026-11-13**. When it expires, Kitchen stops answering, though your kitchen data stays safe. Renew it a few days early. It takes about 5 minutes.

Keep keys private. Paste them only where these steps say, never into chat.

1. **Create the new key**
   - Go to [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) and choose **Create Key**.
   - Name it `wellness-coach-<month>` (for example `wellness-coach-nov`).
   - Scope: **Default workspace**. Expiry: **30 days**.
   - Copy the key (it starts with `sk-ant-`). It's shown only once.
2. **Swap it in Vercel.** In Terminal, in the `my-wellness-coach` folder:
   - Remove the old key. Confirm when it asks:
   ```bash
   npx vercel env rm ANTHROPIC_API_KEY production
   ```
   - Add the new one. Paste the new key when it asks:
   ```bash
   npx vercel env add ANTHROPIC_API_KEY production
   ```
3. **Redeploy** so the app picks up the new key, because Vercel applies setting changes only on the next deploy. Either ask Claude to redeploy, or run:
   ```bash
   npx vercel deploy --prod
   ```
4. **Check it.** Open Kitchen on your phone and send "what do I have?". You should get a normal answer.
5. **Delete the old key** at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) (Delete or Revoke on the old one).

**While you're there:** check spend under [Limits](https://platform.claude.com/settings/limits) and [Billing](https://platform.claude.com/settings/billing). The cap is $10/month, with a $20 target (decision 0020).
6. **Set the next reminder:** ask Claude: "remind me to renew the Wellness Coach Anthropic key in 27 days" (it reuses this runbook).
