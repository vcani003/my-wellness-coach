/**
 * `/reset/<token>`: a sign-in setup or passphrase reset link (SU1 Rec; backend-data.md §7). Same
 * layout as `/join/<token>`: the link is checked first; valid → "Set your passphrase" for the
 * member it was made for (→ `acceptReset`, which keeps their account); otherwise a calm
 * "This link no longer works". Read per request, never prerendered.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getMessages } from "@/lib/i18n";
import { LinkGone } from "@/ui/auth/LinkGone";
import { SetPassphraseForm } from "@/ui/auth/SetPassphraseForm";
import { acceptReset, checkResetLink } from "../actions";

export const metadata: Metadata = { title: getMessages().auth.reset.pageTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="unlock-page">
      <Suspense fallback={null}>
        <Reset params={params} />
      </Suspense>
    </main>
  );
}

async function Reset({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const info = await checkResetLink({ token });
  if (!info.ok) return <LinkGone invitedBy={info.invitedBy} />;
  return <SetPassphraseForm mode="reset" token={token} forName={info.forName ?? ""} invitedBy={info.invitedBy} submit={acceptReset} />;
}
