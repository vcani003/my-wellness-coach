/**
 * The seam between the chat pipeline and whatever reads the user's message (orchestrator spec,
 * milestone 2). Milestone 2 plugs in the deterministic FAKE in `./fake/`; the AI specialist adds
 * the real one behind this same interface (ai.md §1). Interpreters only PROPOSE: the backend's
 * validate → apply path decides what saves (0003).
 */
import type { ApplyResult } from "@/contracts/apply-result";
import type { KitchenState } from "@/contracts/kitchen-state";
import type { ProposedChange } from "@/contracts/proposed-change";

export type InterpretRequest = {
  kitchenId: string;
  userId: string;
  message: { id: string; text: string };
  /** Current kitchen state from domain queries. */
  state: KitchenState;
  /** Kitchen version the proposal is based on. */
  version: number;
  /** Recent turns, oldest first, max ~10. */
  history: Array<{ role: "user" | "assistant"; text: string }>;
};

export type InterpretResult = {
  kind: "change" | "answer" | "clarify";
  /** null for pure answers. */
  proposal: ProposedChange | null;
  /** Draft reply; the route sends it only if every op applied. */
  reply: string;
};

export interface Interpreter {
  interpret(req: InterpretRequest): Promise<InterpretResult>;
  reword?(req: InterpretRequest, result: InterpretResult, applied: ApplyResult): Promise<string>;
}
