"use client";
/**
 * The frame every widget sits in: a named region, a heading with an expand/collapse button
 * (an accordion bar on phone, ux.md §2), the "Updated" dot as text, and the error boundary.
 */
import { useTranslations } from "next-intl";
import { Collapsible } from "@/ui/primitives/Collapsible";
import { CaretDownIcon } from "@/ui/primitives/icons";
import type { VisibleWidget } from "./layout";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";

export function WidgetFrame({
  widget,
  onToggle,
  onRetry,
}: {
  widget: VisibleWidget;
  onToggle: (expanded: boolean) => void;
  onRetry: () => void;
}) {
  const t = useTranslations();
  const { def, expanded, updated } = widget;
  const title = t(def.titleKey);
  const Summary = def.Summary;
  const Body = def.Component;
  return (
    <section
      aria-label={title}
      data-widget={def.id}
      className="scroll-mt-4 rounded-lg border border-border-default bg-surface-raised shadow-card"
    >
      <Collapsible.Root open={expanded} onOpenChange={onToggle}>
        <h2 className="text-title font-strong">
          <Collapsible.Trigger className="flex min-h-tap w-full items-center gap-2 rounded-lg px-4 py-3 text-left">
            <span>{title}</span>
            {Summary && (
              <span className="text-small font-regular text-text-muted">
                <Summary />
              </span>
            )}
            {updated && (
              <span className="flex items-center gap-1 text-caption font-strong text-highlight-text">
                <span aria-hidden="true" className="size-2 rounded-full bg-highlight-text" />
                {t("workspace.updated")}
              </span>
            )}
            <CaretDownIcon
              aria-hidden="true"
              className={`ml-auto size-icon text-text-muted transition-transform duration-(--motion-duration-gentle) ease-gentle ${expanded ? "rotate-180" : ""}`}
            />
          </Collapsible.Trigger>
        </h2>
        <Collapsible.Panel className="px-4 pb-4">
          <WidgetErrorBoundary
            widgetId={def.id}
            onRetry={onRetry}
            fallback={(retry) => (
              <p className="flex flex-wrap items-center gap-2 rounded-md bg-error-bg px-4 py-3 text-small text-error-text">
                {t("workspace.widgetError")}
                <button type="button" onClick={retry} className="min-h-tap rounded-button px-3 font-medium text-accent-text underline">
                  {t("workspace.retry")}
                </button>
              </p>
            )}
          >
            <Body onRetry={onRetry} />
          </WidgetErrorBoundary>
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  );
}
