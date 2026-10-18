/**
 * Dated week plan eval cases (0045 KOS1, KOS12), scored by exact rules. Interpreter-agnostic: the
 * same cases run against the fake in the unit tests (tests/unit/week-plan-ai.test.ts, free) and
 * against the real model in `npm run eval` (interpret.eval.ts, real money). Relative days are
 * resolved by code from the request's `today`, so the expected dates are exact.
 */
import { expect } from "vitest";
import { KitchenState } from "@/contracts/kitchen-state";
import type { Operation, OperationOf, OperationType } from "@/contracts/operations";
import { ProposedChange } from "@/contracts/proposed-change";
import type { InterpretRequest, InterpretResult } from "../interpreter";
import { request, mealInProgress } from "./fixtures";

/** Wednesday. */
export const WEEK_TODAY = "2026-10-14";

type MealSpec = { id: string; title: string; status: "chosen" | "planned" | "cooking"; plannedFor?: string };

export interface WeekPlanCase {
  name: string;
  text: string;
  meals: MealSpec[];
  /** The person's own day; default WEEK_TODAY. */
  today?: string;
  history?: InterpretRequest["history"];
  check: (r: InterpretResult, ops: Operation[]) => void;
}

export function weekPlanCaseRequest(c: WeekPlanCase): InterpretRequest {
  const meals = c.meals.map((m, i) => ({
    ...mealInProgress(m.id, m.title),
    status: m.status,
    ...(m.status !== "chosen" ? { planPosition: i + 1 } : {}),
    ...(m.plannedFor ? { plannedFor: m.plannedFor } : {}),
  }));
  const base = request(c.text, [], c.history ?? []);
  const plan = meals.filter((m) => m.status !== "chosen").map((m) => m.id);
  return { ...base, state: KitchenState.parse({ ...base.state, meals, plan }), today: c.today ?? WEEK_TODAY };
}

export function opsOf(r: InterpretResult): Operation[] {
  return r.proposal ? ProposedChange.parse(r.proposal).operations : [];
}

const only = <T extends OperationType>(ops: Operation[], type: T) => ops.filter((o): o is OperationOf<T> => o.type === type);

const CURRY: MealSpec = { id: "meal-curry", title: "Chicken curry", status: "chosen" };
const PASTA: MealSpec = { id: "meal-pasta", title: "Pasta", status: "planned", plannedFor: "2026-10-15" };
const PHO: MealSpec = { id: "meal-pho", title: "Beef pho", status: "planned" };

export const WEEK_PLAN_CASES: WeekPlanCase[] = [
  {
    name: "week plan: 'plan the curry for Tuesday' → planned for next Tuesday (resolved by code)",
    text: "plan the curry for Tuesday",
    meals: [CURRY, PASTA],
    check: (r, ops) => {
      expect(r.kind).toBe("change");
      const [plan] = only(ops, "meal.plan");
      expect(plan).toMatchObject({ target: { mealId: "meal-curry" }, date: "2026-10-20" });
      expect(only(ops, "meal.date")).toHaveLength(0);
    },
  },
  {
    name: "week plan: 'move the pasta to Friday' → the pasta's day changes",
    text: "move the pasta to Friday",
    meals: [CURRY, PASTA],
    check: (r, ops) => {
      const dated = [...only(ops, "meal.date"), ...only(ops, "meal.plan")];
      expect(dated).toHaveLength(1);
      expect(dated[0]).toMatchObject({ target: { mealId: "meal-pasta" }, date: "2026-10-16" });
    },
  },
  {
    name: "week plan: 'take the day off the pasta' → undated again",
    text: "take the day off the pasta",
    meals: [CURRY, PASTA],
    check: (r, ops) => {
      expect(only(ops, "meal.date")).toEqual([expect.objectContaining({ target: { mealId: "meal-pasta" }, date: null })]);
    },
  },
  {
    name: "week plan: 'Saturday' on a Saturday is today, from the message's own day",
    text: "plan the curry for Saturday",
    meals: [CURRY],
    today: "2026-10-17",
    check: (r, ops) => {
      expect(only(ops, "meal.plan")).toEqual([expect.objectContaining({ target: { mealId: "meal-curry" }, date: "2026-10-17" })]);
    },
  },
  {
    name: "week plan: 'plan the curry for tomorrow' → tomorrow",
    text: "plan the curry for tomorrow",
    meals: [CURRY],
    check: (r, ops) => {
      expect(only(ops, "meal.plan")).toEqual([expect.objectContaining({ target: { mealId: "meal-curry" }, date: "2026-10-15" })]);
    },
  },
  {
    name: "week plan: a vague day ('next week') asks which day and plans nothing",
    text: "plan the curry for next week",
    meals: [CURRY],
    check: (r, ops) => {
      expect(r.kind).toBe("clarify");
      expect(only(ops, "meal.plan")).toHaveLength(0);
      expect(r.proposal?.clarification?.question).toBe("Which day?");
    },
  },
  {
    name: "week plan: 'what are we eating this week?' is answered from the plan, by code",
    text: "what are we eating this week?",
    meals: [CURRY, PASTA, PHO],
    check: (r, ops) => {
      expect(r.kind).toBe("answer");
      expect(ops).toHaveLength(0);
      expect(r.reply).toBe("This week: Tomorrow: Pasta. No day yet: Beef pho.");
    },
  },
  {
    name: "week needs: 'add what we need for this week's meals' → the turn adds them (no list_add from the model)",
    text: "add what we need for this week's meals",
    meals: [PASTA, PHO],
    check: (r, ops) => {
      expect(r.weekNeeds).toEqual({ add: true });
      expect(only(ops, "shopping.add")).toHaveLength(0);
    },
  },
  {
    name: "week needs: 'what do we need for this week's meals?' → listed, not added",
    text: "what do we need for this week's meals?",
    meals: [PASTA, PHO],
    check: (r, ops) => {
      expect(r.weekNeeds).toEqual({ add: false });
      expect(ops).toHaveLength(0);
    },
  },
];
