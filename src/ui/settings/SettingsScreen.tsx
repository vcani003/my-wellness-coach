"use client";
/**
 * Settings (ux.md §7; 0015, 0017, 0019) at `/settings`, inside the main layout so the chat dock
 * stays (Edit note is fixed in chat, 0007). Sections:
 * - **Account:** your name; **Set your passphrase** / **Change passphrase** (SU1 Rec, a sheet);
 *   **Sign out** (this device), **Sign out everywhere** (confirm sheet).
 * - **Kitchen:** "Shared with Levi". For each other member without a passphrase, **Send sign-in
 *   setup link** (a reset link, so they keep their account and what's saved to it); with one,
 *   **Send passphrase reset link**. **Invite someone new** (a join link) for people not in the app
 *   yet, replaced by the reason at the 4-account cap (0006). Each opens `LinkSheet`. Test kitchens
 *   can't make links (0021), so they say so instead.
 * - **Allergies and preferences:** yours with provenance (AI7). One another member added for you
 *   reads "Added by Vero, needs you to confirm" with **Confirm / Edit note / Remove**; only you can
 *   change yours (the server checks too). Other members' allergies and diets are read-only.
 * - **Your data:** **Download my data** (`GET /api/me/export`) and **Delete my data** (a confirm
 *   sheet with the typed phrase, `POST /api/me/delete`; D1 explained calmly).
 * - **Privacy and terms:** links to `/privacy` and `/terms`.
 * Never crashes (0018): a failed load shows "Try again"; a failed tap says so in place.
 */
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SettingsRestriction, SettingsView } from "@/contracts/settings";
import { DELETE_CONFIRMATION_PHRASE } from "@/contracts/settings";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { actorName, sentenceCase } from "@/ui/fallbacks";
import { BackIcon, UndoIcon } from "@/ui/primitives/icons";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useConfirmPrompt } from "./ConfirmPrompt";
import { ConfirmSheet } from "./ConfirmSheet";
import { LinkSheet } from "./LinkSheet";
import { PassphraseSheet } from "./PassphraseSheet";
import { clearDeviceData, pendingConfirms, REMEMBER_HEADING_ID, type MemberRestrictions, type SettingsActions } from "./model";
import { newId } from "@/shared/new-id";

export const SETTINGS_HEADING_ID = "settings-heading";

const card = "card flex flex-col gap-3 px-5 py-5";
const secondaryButton = "btn btn-small";
const linkButton = "btn-quiet text-small underline underline-offset-2";

interface Notice {
  text: string;
  changeSetId?: string;
}

export function SettingsScreen({ initial, others, actions }: { initial: SettingsView | null; others: MemberRestrictions[]; actions: SettingsActions }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [loading, setLoading] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Arriving from the header link (or a fresh load): start reading at the heading. From the home
  // banner (`#settings-remember`): start at Allergies and preferences, where the Confirm is.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.closest("[data-settings-link], [data-testid='confirm-banner']")) {
      const target = window.location.hash === `#${REMEMBER_HEADING_ID}` ? document.getElementById(REMEMBER_HEADING_ID) : null;
      if (target) {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      } else headingRef.current?.focus();
    }
  }, []);

  const back = () => {
    router.push("/");
    // The Back button goes with this page: put focus on the header's Settings link once home.
    const start = performance.now();
    const tick = () => {
      if (window.location.pathname === "/") return document.querySelector<HTMLElement>("[data-settings-link]")?.focus();
      if (performance.now() - start < 5000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const retry = async () => {
    setLoading(true);
    try {
      setView(await actions.load());
    } catch {
      setView(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <article aria-labelledby={SETTINGS_HEADING_ID} className="place-enter mx-auto flex w-full max-w-prose flex-col gap-5 pb-6">
      <div className="flex flex-col gap-2">
        <button type="button" onClick={back} className="btn btn-small self-start">
          <BackIcon aria-hidden="true" className="size-icon" />
          {t("back")}
        </button>
        <h2 id={SETTINGS_HEADING_ID} ref={headingRef} tabIndex={-1} className="text-display font-medium outline-none">
          {t("heading")}
        </h2>
      </div>

      {view ? (
        <>
          <AccountSection view={view} actions={actions} onView={setView} />
          <KitchenSection view={view} actions={actions} />
          <RememberSection view={view} others={others} actions={actions} onView={setView} />
          <DataSection view={view} />
        </>
      ) : (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
          <span>{t("loadFailed")}</span>
          <button
            type="button"
            onClick={() => void retry()}
            aria-disabled={loading || undefined}
            className="min-h-tap rounded-button px-3 font-medium text-accent-text underline"
          >
            {loading ? t("retrying") : t("retry")}
          </button>
        </div>
      )}
      <PoliciesSection />
    </article>
  );
}

function AccountSection({ view, actions, onView }: { view: SettingsView; actions: SettingsActions; onView: (view: SettingsView) => void }) {
  const t = useTranslations("settings.account");
  const [confirming, setConfirming] = useState(false);
  const [settingPassphrase, setSettingPassphrase] = useState(false);
  const [saved, setSaved] = useState(false);
  const hasPassphrase = view.members.find((m) => m.isYou)?.hasPassphrase ?? false;

  const passphraseSaved = async () => {
    setSaved(true);
    // Flip "Set your passphrase" to "Change passphrase" now; refresh from the server after.
    onView({ ...view, members: view.members.map((m) => (m.isYou ? { ...m, hasPassphrase: true } : m)) });
    try {
      const fresh = await actions.load();
      if (fresh) onView(fresh);
    } catch {
      // The optimistic view is right; the next visit reads it again.
    }
  };
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    setFailed(false);
    try {
      clearDeviceData();
      await actions.signOut(); // redirects to /unlock
    } catch {
      setSigningOut(false);
      setFailed(true);
    }
  };

  return (
    <section aria-labelledby="settings-account" className={card}>
      <h3 id="settings-account" className="text-title font-medium">
        {t("heading")}
      </h3>
      <dl className="flex flex-col">
        <dt className="text-caption font-strong text-text-muted">{t("name")}</dt>
        <dd className="text-body">{view.me.name}</dd>
      </dl>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => {
            setSaved(false);
            setSettingPassphrase(true);
          }}
          aria-describedby="settings-passphrase-hint"
          className={`${secondaryButton} self-start`}
        >
          {hasPassphrase ? t("changePassphrase") : t("setPassphrase")}
        </button>
        <p id="settings-passphrase-hint" className="text-caption text-text-muted">
          {hasPassphrase ? t("changePassphraseHint", { name: view.me.name }) : t("setPassphraseHint")}
        </p>
        <p role="status" className="text-small text-success-text empty:hidden">
          {saved ? t("passphraseSaved") : ""}
        </p>
      </div>
      <PassphraseSheet
        open={settingPassphrase}
        onOpenChange={setSettingPassphrase}
        hasPassphrase={hasPassphrase}
        userName={view.me.name}
        change={actions.changePassphrase}
        onSaved={() => void passphraseSaved()}
      />
      <div className="flex flex-col gap-1">
        <button type="button" onClick={() => void signOut()} disabled={signingOut} aria-describedby="settings-signout-hint" className={`${secondaryButton} self-start`}>
          {signingOut ? t("signingOut") : t("signOut")}
        </button>
        <p id="settings-signout-hint" className="text-caption text-text-muted">
          {t("signOutHint")}
        </p>
        {failed && (
          <p role="alert" className="text-small text-error-text">
            {t("confirm.failed")}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <button type="button" onClick={() => setConfirming(true)} aria-describedby="settings-everywhere-hint" className={`${secondaryButton} self-start`}>
          {t("signOutEverywhere")}
        </button>
        <p id="settings-everywhere-hint" className="text-caption text-text-muted">
          {t("signOutEverywhereHint")}
        </p>
      </div>
      <ConfirmSheet
        open={confirming}
        onOpenChange={setConfirming}
        title={t("confirm.title")}
        confirmLabel={t("confirm.confirm")}
        busyLabel={t("signingOut")}
        cancelLabel={t("confirm.cancel")}
        failedText={t("confirm.failed")}
        onConfirm={async () => {
          clearDeviceData();
          await actions.signOutEverywhere(); // redirects to /unlock
          return true;
        }}
      >
        <p>{t("confirm.body")}</p>
      </ConfirmSheet>
    </section>
  );
}

type LinkFor = { kind: "setup" | "reset"; member: { id: string; name: string } } | { kind: "invite" } | null;

function KitchenSection({ view, actions }: { view: SettingsView; actions: SettingsActions }) {
  const t = useTranslations("settings.kitchen");
  const locale = useLocale();
  const [linkFor, setLinkFor] = useState<LinkFor>(null);
  const othersList = view.members.filter((m) => !m.isYou);
  const others = othersList.map((m) => m.name);
  const canLink = view.kitchen !== null && !view.kitchen.isTest;

  const sheet = (() => {
    if (!linkFor) return { title: "", body: "", create: async () => ({ ok: false as const, error: { key: "failed" as const } }) };
    if (linkFor.kind === "invite") return { title: t("sheet.inviteTitle"), body: t("sheet.inviteBody"), create: () => actions.createInvite({ purpose: "join" }) };
    const name = linkFor.member.name;
    const userId = linkFor.member.id;
    return linkFor.kind === "setup"
      ? { title: t("sheet.setupTitle", { name }), body: t("sheet.setupBody", { name }), create: () => actions.createResetLink({ userId }) }
      : { title: t("sheet.resetTitle", { name }), body: t("sheet.resetBody", { name }), create: () => actions.createResetLink({ userId }) };
  })();

  return (
    <section aria-labelledby="settings-kitchen" className={card}>
      <h3 id="settings-kitchen" className="text-title font-medium">
        {t("heading")}
      </h3>
      {view.kitchen ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-body font-medium">{view.kitchen.name}</p>
          <p className="text-body text-text-muted">
            {others.length ? t("sharedWith", { names: new Intl.ListFormat(locale, { type: "conjunction" }).format(others) }) : t("justYou")}
          </p>
        </div>
      ) : (
        <p className="text-body text-text-muted">{t("none")}</p>
      )}
      {canLink && othersList.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-default">
          {othersList.map((m) => (
            <li key={m.id} data-member-access={m.id} className="flex flex-col gap-1 py-3 first:pt-0">
              {!m.hasPassphrase && <p className="text-small text-text-muted">{t("noPassphrase", { name: m.name })}</p>}
              <button
                type="button"
                onClick={() => setLinkFor({ kind: m.hasPassphrase ? "reset" : "setup", member: { id: m.id, name: m.name } })}
                aria-label={m.hasPassphrase ? t("sendResetLabel", { name: m.name }) : t("sendSetupLabel", { name: m.name })}
                className={m.hasPassphrase ? `${linkButton} self-start px-0` : `${secondaryButton} self-start`}
              >
                {m.hasPassphrase ? t("sendReset") : t("sendSetup")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canLink &&
        (view.accountsFull ? (
          <p className="text-small text-text-muted">{t("full")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <button type="button" onClick={() => setLinkFor({ kind: "invite" })} aria-describedby="settings-invite-hint" className={`${secondaryButton} self-start`}>
              {t("invite")}
            </button>
            <p id="settings-invite-hint" className="text-caption text-text-muted">
              {t("inviteHint")}
            </p>
          </div>
        ))}
      {view.kitchen?.isTest && <p className="text-caption text-text-muted">{t("testKitchen")}</p>}
      <LinkSheet open={linkFor !== null} onOpenChange={(open) => !open && setLinkFor(null)} title={sheet.title} body={sheet.body} create={sheet.create} />
    </section>
  );
}

type Busy = { id: string; action: "verify" | "remove" } | null;

function RememberSection({
  view,
  others,
  actions,
  onView,
}: {
  view: SettingsView;
  others: MemberRestrictions[];
  actions: SettingsActions;
  onView: (view: SettingsView) => void;
}) {
  const t = useTranslations("settings.remember");
  const tAll = useTranslations();
  const formatMsg = useFormatMsg();
  const kitchenActions = useKitchenActions();
  const { setPending, fillComposer } = useConfirmPrompt();
  const [busy, setBusy] = useState<Busy>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const show = (next: SettingsView | null) => {
    if (!next) return;
    onView(next);
    setPending(pendingConfirms(next));
  };
  const focusNotice = () => requestAnimationFrame(() => noticeRef.current?.focus());

  const tap = async (r: SettingsRestriction, action: "verify" | "remove") => {
    if (busy) return;
    setBusy({ id: r.id, action });
    setFailed(null);
    try {
      const res = await actions[action]({ tapId: newId(), restrictionId: r.id });
      if (!res.ok) {
        setFailed(r.id);
        return;
      }
      kitchenActions.showOwn(res.result);
      show(res.settings ?? (await actions.load()));
      const summary = res.result.applied[0]?.summary;
      setNotice({ text: summary ? formatMsg(summary) : t("undone"), changeSetId: res.result.changeSetId });
      focusNotice();
    } catch {
      setFailed(r.id);
    } finally {
      setBusy(null);
    }
  };

  const undo = async (changeSetId: string) => {
    try {
      const res = await kitchenActions.undo(changeSetId);
      if (res.ok && res.result.applied.length && !res.result.rejected.length) {
        kitchenActions.showOwn(res.result);
        show(await actions.load());
        setNotice({ text: t("undone") });
        focusNotice();
        return;
      }
    } catch {
      // fall through
    }
    setNotice({ text: t("cantUndo") });
    focusNotice();
  };

  const kindWord = (kind: string) => t("kindWord", { kind });

  return (
    <section aria-labelledby={REMEMBER_HEADING_ID} className={card}>
      <div className="flex flex-col gap-1">
        <h3 id={REMEMBER_HEADING_ID} tabIndex={-1} className="scroll-mt-(--topbar-height) text-title font-medium outline-none">
          {t("heading")}
        </h3>
        <p className="text-small text-text-muted">{t("intro")}</p>
      </div>

      {notice && (
        <div ref={noticeRef} tabIndex={-1} className="flex flex-wrap items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-small text-success-text outline-none focus-visible:outline-2">
          <span>{notice.text}</span>
          {notice.changeSetId && (
            <button
              type="button"
              aria-label={t("undoLabel", { change: notice.text })}
              onClick={() => void undo(notice.changeSetId!)}
              className="flex min-h-tap items-center gap-1 rounded-button px-3 font-strong text-accent-text"
            >
              <UndoIcon aria-hidden="true" className="size-icon-sm" />
              {t("undo")}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h4 className="text-caption font-strong tracking-wide text-text-muted uppercase">{t("yours")}</h4>
        {view.restrictions.length ? (
          <ul className="flex flex-col divide-y divide-border-default">
            {view.restrictions.map((r) => {
              const by = actorName(r.addedBy, tAll);
              const needsYou = !r.verified && !r.addedByYou;
              const label = { subject: r.subject, kind: kindWord(r.kind) };
              const rowBusy = busy?.id === r.id;
              return (
                <li key={r.id} data-restriction={r.id} className="flex flex-col gap-1 py-3">
                  <RestrictionText kind={r.kind} subject={r.subject} note={r.note} />
                  <p className={`text-small ${needsYou ? "font-strong text-text-default" : "text-text-muted"}`}>
                    {r.addedByYou ? t("own.self") : needsYou ? t("own.needsYou", { name: by }) : t("own.confirmed", { name: by })}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {needsYou && (
                      <button
                        type="button"
                        onClick={() => void tap(r, "verify")}
                        disabled={busy !== null}
                        aria-label={t("confirmLabel", label)}
                        className="btn btn-primary btn-small"
                      >
                        {rowBusy && busy?.action === "verify" ? t("saving") : t("confirm")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => fillComposer(t("editNoteText", label))}
                      disabled={busy !== null}
                      aria-label={t("editNoteLabel", label)}
                      className={secondaryButton}
                    >
                      {t("editNote")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void tap(r, "remove")}
                      disabled={busy !== null}
                      aria-label={t("removeLabel", label)}
                      className={linkButton}
                    >
                      {rowBusy && busy?.action === "remove" ? t("saving") : t("remove")}
                    </button>
                  </div>
                  {failed === r.id && (
                    <p role="alert" className="text-small text-error-text">
                      {t("failed")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-small text-text-muted">{t("empty")}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-caption font-strong tracking-wide text-text-muted uppercase">{t("preferences")}</h4>
        {view.preferences.length ? (
          <>
            <ul className="flex flex-col gap-1">
              {view.preferences.map((p) => (
                <li key={p.id} className="text-body">
                  {p.statement}
                </li>
              ))}
            </ul>
            <p className="text-caption text-text-muted">{t("preferencesHint")}</p>
          </>
        ) : (
          <p className="text-small text-text-muted">{t("preferencesEmpty")}</p>
        )}
      </div>

      {others.map(({ member, restrictions }) => (
        <div key={member.id} className="flex flex-col gap-2" data-member={member.id}>
          <h4 className="text-caption font-strong tracking-wide text-text-muted uppercase">{t("memberHeading", { name: member.name })}</h4>
          {restrictions.length ? (
            <>
              <ul className="flex flex-col divide-y divide-border-default">
                {restrictions.map((r) => {
                  const byYou = !("missing" in r.addedBy) && r.addedBy.id === view.me.id;
                  const name = actorName(r.addedBy, tAll);
                  const owner = member.name;
                  const line = r.addedByOwner
                    ? t("theirs.self", { owner })
                    : byYou
                      ? t(r.verified ? "theirs.byYouConfirmed" : "theirs.byYouNeeds", { owner })
                      : t(r.verified ? "theirs.confirmed" : "theirs.needs", { name, owner });
                  return (
                    <li key={r.id} className="flex flex-col gap-1 py-3">
                      <RestrictionText kind={r.kind} subject={r.subject} note={r.note} />
                      <p className="text-small text-text-muted">{line}</p>
                    </li>
                  );
                })}
              </ul>
              <p className="text-caption text-text-muted">{t("onlyOwner", { name: member.name })}</p>
            </>
          ) : (
            <p className="text-small text-text-muted">{t("theirEmpty", { name: member.name })}</p>
          )}
        </div>
      ))}
    </section>
  );
}

function RestrictionText({ kind, subject, note }: { kind: SettingsRestriction["kind"]; subject: string; note?: string }) {
  const t = useTranslations("settings.remember");
  const locale = useLocale();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-button px-2 text-caption font-strong ${
            kind === "allergy" ? "border border-allergy-border bg-allergy-bg text-allergy-text" : "bg-surface-sunken text-text-muted"
          }`}
        >
          {t(`kind.${kind}`)}
        </span>
        <span className="text-body font-medium">{sentenceCase(subject, locale)}</span>
      </div>
      {note && <p className="text-small">{t("note", { note })}</p>}
    </>
  );
}

function DataSection({ view }: { view: SettingsView }) {
  const t = useTranslations("settings.data");
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const lastMember = view.members.length <= 1;

  const deleteMyData = async () => {
    const res = await fetch("/api/me/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: DELETE_CONFIRMATION_PHRASE }),
    });
    if (!res.ok) return false;
    clearDeviceData();
    router.replace("/unlock");
    return true;
  };

  return (
    <section aria-labelledby="settings-data" className={card}>
      <h3 id="settings-data" className="text-title font-medium">
        {t("heading")}
      </h3>
      <div className="flex flex-col gap-1">
        <a href="/api/me/export" download aria-describedby="settings-download-hint" className={`${secondaryButton} flex items-center self-start`}>
          {t("download")}
        </a>
        <p id="settings-download-hint" className="text-caption text-text-muted">
          {t("downloadHint")}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <button type="button" onClick={() => setDeleting(true)} aria-describedby="settings-delete-hint" className={`${secondaryButton} self-start text-error-text`}>
          {t("delete")}
        </button>
        <p id="settings-delete-hint" className="text-caption text-text-muted">
          {t("deleteHint")}
        </p>
      </div>
      <ConfirmSheet
        open={deleting}
        onOpenChange={setDeleting}
        title={t("sheet.title")}
        tone="danger"
        confirmLabel={t("sheet.confirm")}
        busyLabel={t("sheet.deleting")}
        cancelLabel={t("sheet.cancel")}
        failedText={t("sheet.failed")}
        phrase={{ value: DELETE_CONFIRMATION_PHRASE, label: t("sheet.label", { phrase: DELETE_CONFIRMATION_PHRASE }) }}
        onConfirm={deleteMyData}
      >
        <p>{t("sheet.removes")}</p>
        <p>{t("sheet.stays")}</p>
        <p>{lastMember ? t("sheet.kitchenGoes") : t("sheet.kitchenStays")}</p>
        <p className="text-text-muted">{t("sheet.final")}</p>
      </ConfirmSheet>
    </section>
  );
}

function PoliciesSection() {
  const t = useTranslations("settings.policies");
  return (
    <section aria-labelledby="settings-policies" className={card}>
      <h3 id="settings-policies" className="text-title font-medium">
        {t("heading")}
      </h3>
      <ul className="flex flex-col">
        <li>
          <Link href="/privacy" className="flex min-h-tap items-center text-body font-medium text-accent-text underline underline-offset-2">
            {t("privacy")}
          </Link>
        </li>
        <li>
          <Link href="/terms" className="flex min-h-tap items-center text-body font-medium text-accent-text underline underline-offset-2">
            {t("terms")}
          </Link>
        </li>
      </ul>
    </section>
  );
}
