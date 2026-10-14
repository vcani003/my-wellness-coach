"use client";
/**
 * DEV ONLY: the "acting as" switch (Vero / Levi in the local demo kitchen) and a reset button.
 * Only rendered when the server says the dev switch is on, which is never in production.
 */
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { resetDevKitchen, setActingAs } from "@/app/actions";
import { SegmentedRadio } from "@/ui/primitives/RadioGroup";

export function DevBar({ meId, members }: { meId: string; members: { userId: string; displayName: string }[] }) {
  const t = useTranslations("dev");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const reload = () => window.location.reload();
  return (
    <div className="flex flex-wrap items-center gap-x-3 border-b border-border-default bg-warning-bg px-4 py-1 text-caption text-warning-text">
      <span className="font-strong">{t("label")}</span>
      <SegmentedRadio
        label={t("actingAs")}
        value={meId}
        disabled={pending}
        options={members.map((m) => ({ value: m.userId, label: m.displayName }))}
        onChange={(userId) =>
          startTransition(async () => {
            if ((await setActingAs(userId)).ok) reload();
          })
        }
      />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const out = await resetDevKitchen();
            if (out.ok) reload();
            else setFailed(true);
          })
        }
        className="min-h-tap rounded-button px-3 font-strong underline"
      >
        {pending ? t("resetting") : t("reset")}
      </button>
      {failed && <span>{t("resetFailed")}</span>}
    </div>
  );
}
