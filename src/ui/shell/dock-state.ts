/** The chat dock's states (ux.md §1; 0017 UX3, amended by 0059 PF3). */
export type DockState = "peek" | "full" | "minimized";

/** The chat's state when the app opens (0059 PF3): Minimized on phone, the open column on desktop. */
export function launchDock(desktop: boolean): DockState {
  return desktop ? "peek" : "minimized";
}
