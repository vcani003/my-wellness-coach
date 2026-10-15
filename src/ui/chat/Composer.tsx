"use client";
/**
 * The message box (ux.md §4). Enter sends, Shift+Enter adds a line. Focus stays here after Send
 * (frontend.md §6). 16 px text, so iPhone doesn't zoom in.
 */
import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { SendIcon } from "@/ui/primitives/icons";

export interface ComposerHandle {
  focus(): void;
  /** Fill the box (suggestion buttons) and put the cursor at the end. */
  fill(text: string): void;
}

export const Composer = forwardRef<ComposerHandle, { busy: boolean; onSend: (text: string) => boolean }>(
  function Composer({ busy, onSend }, ref) {
    const t = useTranslations("chat");
    const id = useId();
    const [text, setText] = useState("");
    const box = useRef<HTMLTextAreaElement>(null);

    /** Fit the text (or, when empty, the placeholder) up to about five lines. */
    const grow = () => {
      const el = box.current;
      if (!el) return;
      const empty = el.value === "";
      if (empty) el.value = el.placeholder;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`;
      if (empty) el.value = "";
    };
    useEffect(grow, []);

    useImperativeHandle(ref, () => ({
      focus: () => box.current?.focus(),
      fill: (value: string) => {
        setText(value);
        requestAnimationFrame(() => {
          const el = box.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(value.length, value.length);
          grow();
        });
      },
    }));

    const submit = () => {
      if (onSend(text)) {
        setText("");
        requestAnimationFrame(grow);
      }
      box.current?.focus();
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    };

    return (
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t("composerLabel")}
        </label>
        <textarea
          id={id}
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={onKeyDown}
          enterKeyHint="send"
          autoComplete="off"
          placeholder={t("composerPlaceholder")}
          className="min-h-tap flex-1 resize-none rounded-lg border-[1.5px] border-border-strong bg-surface-raised px-4 py-2 text-body text-text-default shadow-card placeholder:text-text-muted"
        />
        <button
          type="submit"
          aria-label={t("send")}
          disabled={busy || text.trim() === ""}
          className="btn btn-primary size-tap shrink-0 p-0"
        >
          <SendIcon aria-hidden="true" className="size-icon" />
        </button>
      </form>
    );
  },
);
