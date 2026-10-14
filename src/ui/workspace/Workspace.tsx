"use client";
/** The workspace: the registry's widgets, shown, ordered and expanded by `selectWidgets`. */
import type { Dispatch } from "react";
import type { KitchenState } from "@/contracts/kitchen-state";
import { selectWidgets, type WorkspaceEvent, type WorkspaceState } from "./layout";
import type { Layout, WidgetDef, WidgetSession } from "./types";
import { WidgetFrame } from "./WidgetFrame";

export function Workspace({
  registry,
  state,
  dispatch,
  data,
  layout,
  session,
  onRetry,
}: {
  registry: readonly WidgetDef[];
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceEvent>;
  data: KitchenState | null;
  layout: Layout;
  session?: WidgetSession;
  onRetry: () => void;
}) {
  const widgets = selectWidgets(state, { registry, data, layout, session });
  return (
    <div className="flex flex-col gap-5">
      {widgets.map((w) => (
        <WidgetFrame
          key={w.def.id}
          widget={w}
          onToggle={(expanded) => dispatch({ type: "userToggled", id: w.def.id, expanded })}
          onClose={w.def.lifetime === "session" ? () => dispatch({ type: "userClosed", id: w.def.id }) : undefined}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}
