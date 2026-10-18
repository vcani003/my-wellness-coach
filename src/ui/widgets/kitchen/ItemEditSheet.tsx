"use client";
/**
 * The item's edit sheet (0045 KOS3; item-actions.md §2 re-cut for Kitchen OS, 0048 bright look):
 * a bottom sheet on a phone, a centred dialog on desktop. Top to bottom: the item's tile and
 * "Edit fish sauce"; which batch (only with several, KOS4-e); Name (focused first); Amount
 * ("Leave it empty if you're not sure."); How much is left? (acts at once); Where is it? (the
 * current place marked "now"); What kind of thing is it? (the 12 types); Staple (acts at once);
 * Remove (asks once). Save sends name / amount / place / type together and is off until something
 * differs. See `ItemEdit.tsx` for what each answer does.
 */
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState, type FormEvent } from "react";
import {
  ITEM_CATEGORIES,
  type ItemCategory,
  type Location,
  type StockLevel,
} from "@/contracts/common";
import type { ItemRow } from "@/contracts/kitchen-state";
import { actorName, byOther, sentenceCase } from "@/ui/fallbacks";
import { AlertDialog, Dialog, SheetBackdrop, SheetPopup } from "@/ui/primitives/Dialog";
import { FoodTile } from "@/ui/primitives/FoodTile";
import {
  CheckIcon,
  CloseIcon,
  CounterIcon,
  FreezerIcon,
  FridgeIcon,
  PantryIcon,
} from "@/ui/primitives/icons";
import { ChoiceTiles, type ChoiceOption } from "@/ui/primitives/RadioGroup";
import { Switch } from "@/ui/primitives/Switch";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import {
  SheetNoteView,
  useItemEdit,
  type ItemEditControl,
  type SheetAnswer,
} from "./ItemEdit";
import {
  ALL_BATCHES,
  AMOUNT_MAX,
  baselineFor,
  EMPTY_DRAFT,
  editPayload,
  hasChanges,
  NAME_MAX,
  pickableBatches,
  validate,
  type EditDraft,
  type FieldError,
} from "./item-edit-model";
import { LEVELS, LevelMeter, TONE } from "./StockLevel";

const PLACES: readonly Location[] = ["fridge", "freezer", "pantry", "counter"];
const PLACE_ICON = {
  fridge: FridgeIcon,
  freezer: FreezerIcon,
  pantry: PantryIcon,
  counter: CounterIcon,
} as const;

/** The Kitchen place's one sheet; open while `control.editing` is set. */
export function ItemEditSheet() {
  const control = useItemEdit();
  const { snapshot } = useKitchenData();
  const editing = control?.editing ?? null;
  // The popup stays drawn while the dialog closes (Base UI plays its closing transition through
  // it, globals.css .sheet-motion), so keep the last opening until the next one.
  const [shown, setShown] = useState(editing);
  if (editing && editing !== shown) setShown(editing);
  if (!control) return null;
  // The live row (your own level / Staple changes show at once); the tapped one if it has left.
  const item = shown
    ? (snapshot.state?.items.find((i) => i.id === shown.itemId) ?? shown.item)
    : null;
  return (
    <Dialog.Root
      open={Boolean(editing)}
      onOpenChange={(next) => !next && control.close()}
    >
      <Dialog.Portal>
        <SheetBackdrop />
        {shown && item && (
          <SheetBody key={shown.sheet} item={item} control={control} />
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SheetBody({
  item,
  control,
}: {
  item: ItemRow;
  control: ItemEditControl;
}) {
  const t = useTranslations("kitchen.edit");
  const tAll = useTranslations();
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const ids = {
    name: useId(),
    amount: useId(),
    amountHint: useId(),
    error: useId(),
    staple: useId(),
    stapleHint: useId(),
    failed: useId(),
  };

  const [batchId, setBatchId] = useState<string>(ALL_BATCHES);
  const [draft, setDraft] = useState<EditDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<FieldError | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Your own Save, from the tap until its answer (it may first wait for a level change, below).
  const [submitting, setSubmitting] = useState(false);
  // How much is left? / Staple act at once; what they're doing, so the sheet can say so.
  const [atOnce, setAtOnce] = useState<{
    what: "level" | "staple";
    status: "saving" | "saved";
  } | null>(null);
  const inflight = useRef<Promise<SheetAnswer> | null>(null);

  const batches = pickableBatches(item);
  // A batch picked and then used up (Out on it) is gone: back to all of them.
  const picked =
    batchId !== ALL_BATCHES && batches.some((b) => b.id === batchId)
      ? batchId
      : ALL_BATCHES;
  const base = baselineFor(item, picked);
  const edit = editPayload(draft, base);
  const dirty = hasChanges(edit);
  const busy = control.busyId === item.id;
  const off = control.offline;
  const name = item.name.value;
  const batchArg = picked === ALL_BATCHES ? undefined : picked;

  const set = (patch: Partial<EditDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFailed(false);
  };

  // Save tapped while a level (or Staple) change is still saving used to be dropped without a
  // word (Vero's "it doesn't allow me to save"). It now waits for that change, then saves what was
  // typed, based on the version that change moved the sheet to.
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (off || submitting || !dirty) return;
    const problem = validate(draft, base);
    setError(problem);
    if (problem) {
      (problem.field === "name" ? nameRef : amountRef).current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const before = inflight.current;
      // That change failed: its message shows and the typing stays, for another try.
      if (before && (await before) === "failed") return;
      setFailed((await control.save(item, edit, batchArg)) === "failed");
    } finally {
      setSubmitting(false);
    }
  };
  const act = async (
    what: "level" | "staple",
    run: () => Promise<SheetAnswer>,
  ) => {
    if (off || busy || submitting) return;
    setAtOnce({ what, status: "saving" });
    const pending = run();
    inflight.current = pending;
    const answer = await pending;
    if (inflight.current === pending) inflight.current = null;
    setFailed(answer === "failed");
    setAtOnce(answer === "failed" ? null : { what, status: "saved" });
  };

  const placeOptions: ChoiceOption<Location>[] = PLACES.map((place) => {
    const Icon = PLACE_ICON[place];
    return {
      value: place,
      label: tAll(`kitchen.groups.${place}`),
      icon: (
        <span
          aria-hidden="true"
          data-place={place}
          className="place-tile size-tap rounded-sm"
        >
          <Icon className="size-icon" />
        </span>
      ),
      ...(base.place === place ? { tag: t("now") } : {}),
      data: { "data-place-choice": place },
    };
  });
  const typeOptions: ChoiceOption<ItemCategory>[] = ITEM_CATEGORIES.map(
    (c) => ({
      value: c,
      label: tAll(`category.${c}`),
      ...(base.category === c ? { tag: t("now") } : {}),
      data: { "data-type-choice": c },
    }),
  );

  const nameError =
    error?.field === "name" ? t(error.code, { max: NAME_MAX }) : null;
  const amountError =
    error?.field === "amount" ? t(error.code, { max: AMOUNT_MAX }) : null;

  return (
    <SheetPopup
      initialFocus={off ? titleRef : nameRef}
      finalFocus={() => control.finalFocus()}
      aria-describedby={failed ? ids.failed : undefined}
      data-item-sheet={item.id}
      className="fixed inset-x-0 bottom-(--keyboard-inset) z-50 flex max-h-[calc(90dvh-var(--keyboard-inset))] flex-col rounded-t-sheet bg-surface-raised pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none desk:inset-x-auto desk:top-1/2 desk:bottom-auto desk:left-1/2 desk:max-h-[88dvh] desk:w-[34rem] desk:-translate-x-1/2 desk:-translate-y-1/2 desk:rounded-sheet"
    >
      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex items-center gap-3 px-5 pb-3">
          <FoodTile place={base.place ?? "unknown"} />
          <Dialog.Title
            ref={titleRef}
            tabIndex={-1}
            className="min-w-0 flex-1 font-heading text-heading font-medium outline-none"
          >
            {t("title", { name })}
          </Dialog.Title>
          <button
            type="button"
            onClick={control.close}
            aria-label={t("close")}
            className="btn-icon -mr-2"
          >
            <CloseIcon aria-hidden="true" className="size-icon" />
          </button>
        </div>

        {off && (
          <p className="mx-5 mb-3 rounded-md bg-surface-sunken px-3 py-2 text-small text-text-muted">
            {t("offline")}
          </p>
        )}

        {/* A fieldset can't be the scroller in every browser, so a div scrolls and the fieldset turns everything off offline. */}
        <div
          data-sheet-scroll=""
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-1"
        >
          <fieldset disabled={off} className="flex min-w-0 flex-col gap-5 pb-2">
            {batches.length > 0 && (
              <ChoiceTiles
                label={t("batchLabel")}
                hint={t("batchHint")}
                value={picked}
                onChange={(v) => setBatchId(v)}
                disabled={off || busy || submitting}
                layout="list"
                data-batch-choice=""
                options={[
                  {
                    value: ALL_BATCHES,
                    label: t("batchAll", { count: batches.length }),
                    data: { "data-batch": ALL_BATCHES },
                  },
                  ...batches.map((b) => ({
                    value: b.id,
                    label: <BatchLine batch={b} />,
                    data: { "data-batch": b.id },
                  })),
                ]}
              />
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor={ids.name} className="text-body font-medium">
                {t("nameLabel")}
              </label>
              <input
                ref={nameRef}
                id={ids.name}
                value={draft.name ?? base.name}
                onChange={(e) => set({ name: e.target.value })}
                required
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? ids.error : undefined}
                autoComplete="off"
                enterKeyHint="done"
                data-edit-field="name"
                className="field"
              />
              {nameError && (
                <p
                  id={ids.error}
                  className="text-small font-medium text-error-text"
                >
                  {nameError}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={ids.amount} className="text-body font-medium">
                {batches.length > 0 && picked === ALL_BATCHES
                  ? t("amountLabelOldest")
                  : t("amountLabel")}
              </label>
              <input
                ref={amountRef}
                id={ids.amount}
                value={draft.amount ?? base.amount}
                onChange={(e) => set({ amount: e.target.value })}
                aria-invalid={amountError ? true : undefined}
                aria-describedby={
                  amountError
                    ? `${ids.error} ${ids.amountHint}`
                    : ids.amountHint
                }
                autoComplete="off"
                enterKeyHint="done"
                data-edit-field="amount"
                className="field"
              />
              {amountError && (
                <p
                  id={ids.error}
                  className="text-small font-medium text-error-text"
                >
                  {amountError}
                </p>
              )}
              <p id={ids.amountHint} className="text-caption text-text-muted">
                {t("amountHint")}
              </p>
            </div>

            <LevelButtons
              current={base.level}
              disabled={off || busy || submitting}
              status={atOnce?.what === "level" ? atOnce.status : null}
              onPick={(level) => {
                if (level !== base.level)
                  void act("level", () =>
                    control.setLevel(item, level, batchArg),
                  );
              }}
            />

            <SheetNoteView />

            <ChoiceTiles
              label={t("placeLabel")}
              value={draft.place ?? base.place}
              onChange={(place) => set({ place })}
              disabled={off || submitting}
              data-place-choices=""
              options={placeOptions}
            />

            <ChoiceTiles
              label={t("typeLabel")}
              value={draft.category ?? base.category}
              onChange={(category) => set({ category })}
              disabled={off || submitting}
              layout="wrap"
              data-type-choices=""
              options={typeOptions}
            />

            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span id={ids.staple} className="text-body font-medium">
                  {t("stapleLabel")}
                </span>
                <span
                  id={ids.stapleHint}
                  className="text-caption text-text-muted"
                >
                  {t("stapleHint")}
                </span>
              </div>
              <Switch
                checked={Boolean(item.stapleId)}
                onChange={(on) =>
                  void act("staple", () => control.setStaple(item, on))
                }
                disabled={off || busy || submitting}
                labelledBy={ids.staple}
                describedBy={ids.stapleHint}
                data-staple-switch=""
              />
            </div>

            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={off || busy || submitting}
              className="btn-quiet self-start px-0 text-error-text"
            >
              {t("remove")}
            </button>
          </fieldset>
        </div>

        {failed && (
          <p
            id={ids.failed}
            role="alert"
            className="mx-5 mt-3 rounded-md bg-error-bg px-3 py-2 text-small text-error-text"
          >
            {t("failed")}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border-default px-5 pt-3">
          {!dirty && atOnce ? (
            // A level or Staple change is already saved (or saving) and nothing else waits: Done
            // is the one way out, so a greyed-out Save doesn't read as "it won't let me save".
            <button
              type="button"
              onClick={control.close}
              data-edit-done=""
              className="btn btn-primary"
            >
              {t("done")}
            </button>
          ) : (
            <>
              <button type="button" onClick={control.close} className="btn">
                {dirty ? t("cancel") : t("done")}
              </button>
              <button
                type="submit"
                disabled={off || !dirty}
                aria-disabled={submitting || undefined}
                data-edit-save=""
                className="btn btn-primary"
              >
                {submitting ? t("saving") : t("save")}
              </button>
            </>
          )}
        </div>
      </form>

      <RemoveConfirm
        open={confirming}
        name={name}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onRemove={async () => {
          if (busy) return;
          const answer = await control.remove(item);
          setConfirming(false);
          setFailed(answer === "failed");
        }}
      />
    </SheetPopup>
  );
}

/**
 * How much is left? Four toggle buttons, not radios: each acts at once, so arrow keys mustn't
 * walk through (and save) the levels in between. The current one is pressed.
 */
function LevelButtons({
  current,
  disabled,
  status,
  onPick,
}: {
  current: StockLevel | null;
  disabled: boolean;
  /** A pick in this sheet: "Saving…", then "Saved" beside the question (the receipt is below). */
  status: "saving" | "saved" | null;
  onPick: (level: StockLevel) => void;
}) {
  const t = useTranslations();
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className="flex items-baseline justify-between gap-3">
          <span id={labelId} className="text-body font-medium">
            {t("kitchen.edit.levelLabel")}
          </span>
          {/* Not a live region: the announcer already says "Done. Fish sauce: running low". */}
          {status && (
            <span
              data-level-status={status}
              className={`inline-flex shrink-0 items-center gap-1 text-small font-medium ${status === "saved" ? "text-success-text" : "text-text-muted"}`}
            >
              {status === "saved" && (
                <CheckIcon aria-hidden="true" className="size-icon-sm" />
              )}
              {status === "saved"
                ? t("kitchen.edit.levelSaved")
                : t("kitchen.edit.saving")}
            </span>
          )}
        </span>
        <span id={hintId} className="text-caption text-text-muted">
          {t("kitchen.edit.levelHint")}
        </span>
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        data-level-choice=""
        className="grid grid-cols-2 gap-2 desk:grid-cols-4"
      >
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={current === level}
            disabled={disabled}
            onClick={() => onPick(level)}
            data-level={level}
            className="choice"
          >
            <span className={`inline-flex ${TONE[level]}`}>
              <LevelMeter level={level} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              {t(`kitchen.level.${level}`)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** One batch, as the choice says it: "Added Oct 2 · 1 bottle · Fridge · Running low · added by Levi". */
function BatchLine({
  batch,
}: {
  batch: NonNullable<ItemRow["batches"]>[number];
}) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const { me } = useKitchenData();
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { month: "short", day: "numeric" });
  const parts = [
    t("kitchen.batches.added", { date: date(batch.addedAt) }),
    batch.quantity?.value.asSaid,
    batch.location ? t(`kitchen.groups.${batch.location.value}`) : undefined,
    batch.frozen?.value ? t("kitchen.frozen") : undefined,
    batch.defrostedOn && !batch.frozen?.value
      ? t("kitchen.batches.defrostedOn", {
          date: date(batch.defrostedOn.value),
        })
      : undefined,
    batch.stock ? t(`kitchen.level.${batch.stock.value}`) : undefined,
    batch.opened?.value ? t("kitchen.opened") : undefined,
    byOther(batch.createdBy, me.id)
      ? t("kitchen.edit.batchAddedBy", {
          name: sentenceCase(actorName(batch.createdBy, t), locale),
        })
      : t("kitchen.edit.batchAddedByYou"),
  ].filter(Boolean);
  return <span>{parts.join(" · ")}</span>;
}

/** "Remove fish sauce? It'll stay in history." Focus starts on Cancel, the safe choice (0030). */
function RemoveConfirm({
  open,
  name,
  busy,
  onCancel,
  onRemove,
}: {
  open: boolean;
  name: string;
  busy: boolean;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("kitchen.edit");
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="scrim-motion fixed inset-0 z-50 bg-scrim" />
        <AlertDialog.Popup
          initialFocus={cancelRef}
          data-remove-confirm=""
          className="sheet pop-motion fixed inset-x-4 top-1/2 z-50 flex -translate-y-1/2 flex-col gap-2 rounded-sheet bg-surface-raised p-5 shadow-pop outline-none desk:inset-x-auto desk:left-1/2 desk:w-[24rem] desk:-translate-x-1/2"
        >
          <AlertDialog.Title className="font-heading text-title font-medium">
            {t("removeTitle", { name })}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-body text-text-muted">
            {t("removeBody")}
          </AlertDialog.Description>
          <div className="mt-3 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              className="btn"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-disabled={busy || undefined}
              className="btn btn-danger"
            >
              {busy ? t("saving") : t("removeConfirm")}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
