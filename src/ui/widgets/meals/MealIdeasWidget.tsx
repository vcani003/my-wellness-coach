"use client";
/**
 * Meal ideas (ux.md §3, decisions 0009, 0013, 0019): about three cards streaming in, each with the
 * name, a short why, **Uses** and **Missing**, the allergen badge right above Choose, and the
 * assumed-basics reminder under the cards. Not saved: closable (×), replaced by the next request,
 * gone next session. Choose (or naming it in chat) → "Chosen ✓" and the Recipe opens.
 */
import { useLocale, useTranslations } from "next-intl";
import type { KitchenState } from "@/contracts/kitchen-state";
import { useFormatMsg } from "@/ui/chat/format-msg";
import { itemName } from "@/ui/fallbacks";
import { CheckIcon } from "@/ui/primitives/icons";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { AllergenBadge } from "./AllergenBadge";
import { useMeals } from "./MealsContext";
import type { IdeaCard, IdeaSet } from "./session";

export const MEAL_IDEAS_WIDGET_ID = "meals.ideas";

/** The meal chosen from this card, if it's still live (a cancelled one frees the card again). */
export function chosenMeal(state: KitchenState | null, ideaId: string) {
  return state?.meals.find((m) => m.ideaId === ideaId);
}

export function MealIdeasSummary() {
  const t = useTranslations("meals.ideas");
  const { session } = useMeals();
  const ideas = session.ideas;
  if (!ideas) return null;
  return <>{ideas.status === "loading" ? t("summaryLoading") : t("summary", { count: ideas.ideas.length })}</>;
}

export function MealIdeasWidget() {
  const t = useTranslations("meals.ideas");
  const formatMsg = useFormatMsg();
  const { session } = useMeals();
  const set: IdeaSet | null = session.ideas;
  if (!set) return null;

  return (
    <div className="flex flex-col gap-3" aria-busy={set.status !== "ready"}>
      {set.ideas.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-small text-text-muted">{t("loading")}</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-surface-sunken" />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {set.ideas.map((idea) => (
            <IdeaCardView key={idea.ideaId} idea={idea} />
          ))}
        </ul>
      )}
      {set.notes.map((n, i) => (
        <p key={i} className="text-small text-text-muted">
          {formatMsg(n)}
        </p>
      ))}
    </div>
  );
}

function IdeaCardView({ idea }: { idea: IdeaCard }) {
  const t = useTranslations("meals.ideas");
  const tAll = useTranslations();
  const locale = useLocale();
  const { snapshot } = useKitchenData();
  const { session, actions } = useMeals();
  const state = snapshot.state;
  const chosen = chosenMeal(state, idea.ideaId);
  const choosing = session.choosing[idea.ideaId];
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const uses = idea.uses.map((id) => itemName(state?.items.find((i) => i.id === id)?.name.value, tAll, locale).toLocaleLowerCase(locale));

  return (
    <li
      data-entity-id={idea.ideaId}
      className="card flex flex-col gap-2 px-5 py-4"
    >
      <h3 className="text-title font-medium">
        {idea.name}
      </h3>
      <p className="text-small">{idea.why}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-small">
        <dt className="font-strong text-text-muted">{t("uses")}</dt>
        <dd>{uses.length ? list.format(uses) : t("usesNone")}</dd>
        <dt className="font-strong text-text-muted">{t("missing")}</dt>
        <dd>{idea.missing.length ? list.format(idea.missing) : t("missingNone")}</dd>
      </dl>
      <AllergenBadge flags={idea.allergenFlags} />
      {chosen ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex min-h-tap items-center gap-1 text-body font-strong text-success-text">
            <CheckIcon aria-hidden="true" className="size-icon" />
            {t("chosen")}
          </span>
          <button
            type="button"
            onClick={() => actions.openRecipe(chosen.id, { focus: true })}
            className="btn-quiet underline"
            aria-label={t("openRecipeLabel", { name: idea.name })}
          >
            {t("openRecipe")}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            disabled={choosing === "choosing"}
            aria-label={t("chooseLabel", { name: idea.name })}
            onClick={() => void actions.choose(idea.ideaId)}
            className="btn btn-primary self-start"
          >
            {choosing === "choosing" ? t("choosing") : t("choose")}
          </button>
          {choosing === "failed" && (
            <p role="alert" className="rounded-md bg-error-bg px-3 py-2 text-small text-error-text">
              {t("chooseFailed")}
            </p>
          )}
        </>
      )}
    </li>
  );
}
