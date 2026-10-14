/**
 * `/join/<token>`: an invite link (SU1 Rec; backend-data.md §7). The proxy lets it through
 * without a session, with no-referrer / no-store / noindex. The link is checked first: valid →
 * "Join Vero's kitchen" (name + passphrase → `acceptJoin`); unknown, used or expired → a calm
 * "This link no longer works". Read per request, never prerendered.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getMessages } from "@/lib/i18n";
import { LinkGone } from "@/ui/auth/LinkGone";
import { SetPassphraseForm } from "@/ui/auth/SetPassphraseForm";
import { acceptJoin, checkJoinLink } from "../actions";

export const metadata: Metadata = { title: getMessages().auth.join.pageTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="unlock-page">
      <Suspense fallback={null}>
        <Join params={params} />
      </Suspense>
    </main>
  );
}

async function Join({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const info = await checkJoinLink({ token });
  if (!info.ok) return <LinkGone invitedBy={info.invitedBy} />;
  return <SetPassphraseForm mode="join" token={token} invitedBy={info.invitedBy} submit={acceptJoin} />;
}
