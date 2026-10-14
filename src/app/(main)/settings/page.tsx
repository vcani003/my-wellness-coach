/**
 * `/settings` (ux.md §7; 0015, 0017, 0019), inside the main layout so the chat dock stays.
 * Your settings are read on the server; a failed read never fails the page (0018): the screen
 * shows "I couldn't load your settings" with Try again.
 *
 * Other members' allergies and diets are read here too, read-only for you (0019: everyone's
 * allergies are considered, so members can see them). Only those are passed to the phone, never
 * their preferences, and only for members of your own kitchen.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { changePassphrase, createInvite, createResetLink } from "@/app/settings/access-actions";
import { loadSettings, removeRestriction, signOut, signOutEverywhere, verifyRestriction } from "@/app/settings/actions";
import type { SettingsView } from "@/contracts/settings";
import { getMessages } from "@/lib/i18n";
import { getSettingsView } from "@/server/account/settings";
import { getDb } from "@/server/db";
import { toMemberRestrictions, type MemberRestrictions } from "@/ui/settings/model";
import { SettingsScreen } from "@/ui/settings/SettingsScreen";

export const metadata: Metadata = { title: getMessages().settings.pageTitle };

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <Settings />
    </Suspense>
  );
}

async function othersRestrictions(view: SettingsView): Promise<MemberRestrictions[]> {
  const others = view.members.filter((m) => !m.isYou);
  if (!others.length) return [];
  try {
    const db = await getDb();
    return await Promise.all(others.map(async (m) => toMemberRestrictions({ id: m.id, name: m.name }, await getSettingsView(db, m.id))));
  } catch (error) {
    console.error("settings page: couldn't load members' allergies", { error });
    return [];
  }
}

async function Settings() {
  // Per request, never prerendered (Cache Components): wait for the real request first.
  await connection();
  const view = await loadSettings();
  const others = view ? await othersRestrictions(view) : [];
  return (
    <SettingsScreen
      initial={view}
      others={others}
      actions={{
        load: loadSettings,
        verify: verifyRestriction,
        remove: removeRestriction,
        signOut,
        signOutEverywhere,
        createInvite,
        createResetLink,
        changePassphrase,
      }}
    />
  );
}
