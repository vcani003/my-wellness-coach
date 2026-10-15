"use client";
/**
 * The Kitchen OS header (0042): the place's title (the page's one h1), the household's avatars as
 * the way into Settings ("You & household", 0035 b), and the sync status. The status only speaks
 * up when something's off ("Offline"): a status that always says "fine" is noise (calm, 0022).
 * It isn't a live region: the shell says the change once through the app's single Announcer.
 */
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { forwardRef, type Ref } from "react";
import { sentenceCase } from "@/ui/fallbacks";
import { NotSyncedIcon } from "@/ui/primitives/icons";
import type { SyncStatus } from "@/ui/sync/kitchen-sync";
import { DevBar } from "./DevBar";

export const PLACE_TITLE_ID = "place-title";

export interface HeaderProps {
  title: string;
  me: { id: string; name: string };
  members: { userId: string; displayName: string }[];
  devActingAs: boolean;
  sync: SyncStatus;
  /** The phone has a connection (chat is online only, 0044). */
  online?: boolean;
  settingsOpen: boolean;
}

export const Header = forwardRef(function Header(
  { title, me, members, devActingAs, sync, online = true, settingsOpen }: HeaderProps,
  ref: Ref<HTMLElement>,
) {
  const t = useTranslations("app");
  const locale = useLocale();
  // You first, then everyone else in the kitchen (at most three faces).
  const people = [
    { id: me.id, name: me.name },
    ...members.filter((m) => m.userId !== me.id).map((m) => ({ id: m.userId, name: m.displayName })),
  ].slice(0, 3);
  const offline = !online || sync === "stale" || sync === "error";

  return (
    <header ref={ref} className="app-header sticky top-0 z-30 border-b-2 border-border-default bg-surface-default desk:static">
      {devActingAs && <DevBar meId={me.id} members={members} />}
      <div className="flex min-h-tap items-center gap-3 px-4 py-2 desk:px-6">
        <h1 id={PLACE_TITLE_ID} tabIndex={-1} className="min-w-0 flex-1 truncate text-heading font-medium outline-none">
          {title}
        </h1>
        {offline && (
          <span data-sync="offline" className="flex items-center gap-1 rounded-button bg-surface-sunken px-3 py-1 text-caption font-strong text-text-muted">
            <NotSyncedIcon aria-hidden="true" className="size-icon-sm" />
            {t("offline")}
          </span>
        )}
        <Link
          href="/settings"
          data-settings-link=""
          aria-label={t("openSettings", { name: me.name })}
          aria-current={settingsOpen ? "page" : undefined}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-button px-1"
        >
          <span aria-hidden="true" className="flex">
            {people.map((p, i) => (
              <span
                key={p.id}
                className={`flex size-avatar items-center justify-center rounded-full border-2 border-border-outline text-small font-strong ${
                  // One text colour per fill (both pairs pass 4.5:1 in light and dark).
                  i === 0 ? "bg-accent-default text-text-on-accent" : "-ml-2 bg-place-freezer text-text-default"
                }`}
              >
                {sentenceCase(p.name, locale).charAt(0)}
              </span>
            ))}
          </span>
        </Link>
      </div>
    </header>
  );
});
