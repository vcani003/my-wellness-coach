/**
 * Meal ideas and recipes with Claude (ai.md §5, §7). One streamed structured-output call per
 * request (plus at most one regeneration for ideas left out for allergies). Opus 5.5 is a
 * per-task server setting (0020); effort is overridable by env (AI_IDEAS_EFFORT, AI_RECIPE_EFFORT).
 *
 * Never throws (0018): an API error, timeout, refusal, budget stop or unusable output ends the
 * stream with `done` and `ok: false`, plus a plain reply. Nothing is saved here: a recipe comes
 * back as a contract-valid `recipe.save` for the backend to apply (0003).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { standardName } from "@/shared/text";
import { askedAllergies, flagsFor } from "../meals/allergen-guard";
import { basicsNote } from "../meals/basics";
import { labelMaps, renderIdeasRequest, renderPastedRequest, renderRecipeRequest } from "../meals/context";
import { IdeaOut, IdeasOutput, jsonFormat, RecipeIngredientOut as RawIngredient, RecipeOutput } from "../meals/model-output";
import { completeElements, parsePrefix } from "../meals/partial";
import { IDEAS_INSTRUCTIONS, MEALS_PROMPT_VERSION, PASTED_RECIPE_INSTRUCTIONS, RECIPE_INSTRUCTIONS } from "../meals/prompts";
import { toIdea, type IdeaGuardContext } from "../meals/to-ideas";
import { toIngredient, toRecipeResult, toStep, type RecipeBuild } from "../meals/to-recipe";
import type {
  GeneratedIdea,
  IdeasEvent,
  IdeasResult,
  MealAI,
  MealFailure,
  MealIdeasInput,
  PastedRecipeInput,
  RecipeEvent,
  RecipeInput,
  RecipeResult,
} from "../meals/types";
import { allergenExcusedIds, rankUseItUp } from "../meals/use-it-up";
import { BUDGET_EXHAUSTED_REPLY, budgetExhaustedReason, type BudgetReason } from "./budget";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt";
import { estimateCostUsd, taskSettings, type TaskSettings } from "./settings";

type StreamParams = Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, "stream">;
type Message = Anthropic.Beta.Messages.BetaMessage;

/** A streamed call: text deltas as they arrive, then the final message. */
export interface TextStream {
  textDeltas(): AsyncIterable<string>;
  finalMessage(): Promise<Message>;
}

/** The one SDK call we use; injectable so tests run with a mocked client. */
export interface StreamingMessagesApi {
  stream(body: StreamParams, options?: { timeout?: number }): TextStream;
}

export type MealTask = "ideas" | "recipe" | "recipe-paste";

export type MealLog =
  | {
      event: "ai.usage";
      task: MealTask;
      promptVersion: string;
      model: string;
      stopReason: string | null;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      estCostUsd: number;
      ms: number;
    }
  | { event: "ai.budget_exhausted"; task: MealTask; reason: BudgetReason; status: number | undefined; requestId: string | null }
  | { event: "ai.error"; task: MealTask; reason: string };

export interface RealMealOptions {
  messages?: StreamingMessagesApi;
  now?: () => Date;
  log?: (entry: MealLog) => void;
  env?: Record<string, string | undefined>;
}

export const IDEAS_FAILURE_REPLY = "Sorry, I couldn't come up with ideas just now. Please try again.";
export const RECIPE_FAILURE_REPLY = "Sorry, I couldn't write the recipe just now. Please try again.";
export const PASTE_FAILURE_REPLY = "Sorry, I couldn't read that recipe just now, so nothing was saved. Please try again.";
export const PASTE_TOO_LONG_REPLY = "That recipe is too long for me to save. Could you paste just the ingredients and steps?";
export const MEAL_REFUSAL_REPLY = "I can't help with that one.";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const PASTE_MAX = 20_000;
const IDEAS_FORMAT = jsonFormat(IdeasOutput);
const RECIPE_FORMAT = jsonFormat(RecipeOutput);

function sdkStreaming(): StreamingMessagesApi {
  // Retries cover 429/5xx and connection errors; the timeout is per attempt.
  const client = new Anthropic({ maxRetries: 1 });
  return {
    stream(body, options) {
      const s = client.beta.messages.stream(body, options);
      return {
        async *textDeltas() {
          for await (const event of s) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
          }
        },
        finalMessage: () => s.finalMessage(),
      };
    },
  };
}

function textOf(message: Message): string {
  return message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** What one streamed call produces: partial objects as text arrives, then the outcome. */
type CallEvent<T> =
  | { kind: "partial"; obj: Record<string, unknown> }
  | { kind: "end"; ok: true; value: T }
  | { kind: "end"; ok: false; reason: MealFailure; why: string };

export function createRealMealAI(options: RealMealOptions = {}): MealAI {
  let api = options.messages;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((entry) => console.info(JSON.stringify(entry)));
  const env = options.env ?? process.env;

  async function* call<T>(
    task: MealTask,
    settings: TaskSettings,
    instructions: string,
    format: ReturnType<typeof jsonFormat>,
    schema: z.ZodType<T>,
    content: string,
  ): AsyncGenerator<CallEvent<T>> {
    api ??= sdkStreaming();
    const started = Date.now();
    let message: Message;
    try {
      const stream = api.stream(
        {
          model: settings.model,
          max_tokens: settings.maxTokens,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          system: [
            // The interpreter's fixed prompt first: one cached prefix for every call type.
            { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            { type: "text", text: instructions, cache_control: { type: "ephemeral" } },
          ],
          messages: [{ role: "user", content }],
          output_config: { effort: settings.effort, format },
        },
        { timeout: settings.timeoutMs },
      );
      let text = "";
      for await (const delta of stream.textDeltas()) {
        text += delta;
        const obj = parsePrefix(text);
        if (obj) yield { kind: "partial", obj };
      }
      message = await stream.finalMessage();
    } catch (error) {
      const reason = budgetExhaustedReason(error);
      if (reason) {
        const e = error as { status?: number; requestID?: string | null };
        log({ event: "ai.budget_exhausted", task, reason, status: e.status, requestId: e.requestID ?? null });
        yield { kind: "end", ok: false, reason: "budget", why: reason };
        return;
      }
      const why = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      log({ event: "ai.error", task, reason: why });
      yield { kind: "end", ok: false, reason: "failed", why };
      return;
    }

    const u = message.usage;
    log({
      event: "ai.usage",
      task,
      promptVersion: `${PROMPT_VERSION}+${MEALS_PROMPT_VERSION}`,
      model: message.model,
      stopReason: message.stop_reason,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      estCostUsd: estimateCostUsd(u),
      ms: Date.now() - started,
    });

    const fail = (reason: MealFailure, why: string): CallEvent<T> => {
      log({ event: "ai.error", task, reason: why });
      return { kind: "end", ok: false, reason, why };
    };
    if (message.stop_reason === "refusal") return yield fail("refusal", "refusal");
    if (message.stop_reason === "max_tokens") return yield fail("failed", "hit max_tokens");
    let json: unknown;
    try {
      json = JSON.parse(textOf(message));
    } catch {
      return yield fail("failed", "output was not JSON");
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return yield fail("failed", `output failed the schema: ${parsed.error.message}`);
    yield { kind: "end", ok: true, value: parsed.data };
  }

  const failReply = (reason: MealFailure, fallback: string) =>
    reason === "budget" ? BUDGET_EXHAUSTED_REPLY : reason === "refusal" ? MEAL_REFUSAL_REPLY : fallback;

  // ─── Ideas ───────────────────────────────────────────────────────────────────────────

  async function* streamMealIdeas(input: MealIdeasInput): AsyncGenerator<IdeasEvent> {
    const at = now();
    const count = Math.min(Math.max(input.count ?? 3, 1), 5);
    const settings = taskSettings("ideas", env);
    const ranked = rankUseItUp(input.state, at);
    const guard: IdeaGuardContext = {
      ctx: input,
      labels: labelMaps(input).toId,
      useItUp: new Set(ranked.map((u) => u.itemId)),
      allergenExcused: allergenExcusedIds(ranked),
      // Only the user's typed words count as asking (ai.md §6).
      asked: askedAllergies(input.request?.text, input.restrictions),
    };
    const kept: GeneratedIdea[] = [];
    const droppedNames: string[] = [];
    let reply = "";

    /** Runs one call; yields kept ideas as they complete. Returns the failure, if any. */
    async function* pass(content: string): AsyncGenerator<GeneratedIdea, { reason: MealFailure } | null> {
      let processed = 0;
      const take = function* (raw: unknown[]): Generator<GeneratedIdea> {
        for (; processed < raw.length; processed++) {
          const p = IdeaOut.safeParse(raw[processed]);
          if (!p.success) return;
          const verdict = toIdea(p.data, guard);
          if (!verdict) continue;
          const dup = kept.some((k) => standardName(k.name) === standardName(verdict.idea.name));
          if (dup) continue;
          if (!verdict.keep) {
            droppedNames.push(verdict.idea.name);
            continue;
          }
          if (kept.length >= count) continue;
          kept.push(verdict.idea);
          yield verdict.idea;
        }
      };
      for await (const ev of call("ideas", settings, IDEAS_INSTRUCTIONS, IDEAS_FORMAT, IdeasOutput, content)) {
        if (ev.kind === "partial") {
          yield* take(completeElements(ev.obj, "ideas", "reply"));
        } else if (ev.ok) {
          yield* take(ev.value.ideas);
          reply ||= ev.value.reply.trim();
          return null;
        } else {
          return { reason: ev.reason };
        }
      }
      return { reason: "failed" };
    }

    const first = pass(renderIdeasRequest({ ...input, count }, at));
    let failure: { reason: MealFailure } | null = null;
    for (;;) {
      const r = await first.next();
      if (r.done) {
        failure = r.value;
        break;
      }
      yield { type: "idea", idea: r.value };
    }
    // A mid-stream refusal means the partial output is discarded (claude-api skill).
    if (failure && (failure.reason === "refusal" || kept.length === 0)) {
      yield { type: "done", result: { ok: false, reason: failure.reason, reply: failReply(failure.reason, IDEAS_FAILURE_REPLY) } };
      return;
    }

    // One regeneration for ideas left out for allergies (ai.md §6).
    const firstDrops = droppedNames.length;
    if (!failure && firstDrops > 0 && kept.length < count) {
      const extra = [
        "<regenerate>",
        `Already suggested: ${kept.map((k) => k.name).join(", ") || "(none)"}.`,
        `Left out because they contain an allergen from <allergies> that nobody asked for: ${droppedNames.join(", ")}.`,
        `Suggest ${count - kept.length} different idea(s) without those allergens. "reply" may be empty.`,
        "</regenerate>",
      ].join("\n");
      const second = pass(renderIdeasRequest({ ...input, count: count - kept.length }, at, extra));
      for (;;) {
        const r = await second.next();
        if (r.done) break;
        yield { type: "idea", idea: r.value };
      }
    }

    const shortBy = Math.max(0, count - kept.length);
    const droppedForAllergens = Math.min(droppedNames.length, shortBy);
    if (!reply) reply = kept.length ? "Here are some ideas from your kitchen." : "Nothing in your kitchen fits that right now.";
    if (droppedForAllergens > 0) {
      reply += droppedForAllergens === 1
        ? " I left one idea out because of an allergy in your household."
        : ` I left ${droppedForAllergens} ideas out because of an allergy in your household.`;
    }
    const basics: string[] = [];
    for (const b of kept.flatMap((k) => k.basics)) if (!basics.some((x) => standardName(x) === standardName(b))) basics.push(b);
    const note = basicsNote(basics);
    yield { type: "done", result: { ok: true, ideas: kept, reply, notes: note ? [note] : [], droppedForAllergens } };
  }

  // ─── Recipes ─────────────────────────────────────────────────────────────────────────

  async function* recipeStream(
    task: MealTask,
    instructions: string,
    content: string,
    build: StreamBuild,
    failure: string,
  ): AsyncGenerator<RecipeEvent> {
    const settings = taskSettings("recipe", env);
    const { ctx, labels } = build;
    let metaSent = false;
    let ingProcessed = 0;
    let ingSent = 0;
    let stepProcessed = 0;
    let stepSent = 0;

    for await (const ev of call(task, settings, instructions, RECIPE_FORMAT, RecipeOutput, content)) {
      if (ev.kind === "partial") {
        // Parts stream only for an AI recipe; a pasted one is shown once it's read.
        if (build.source !== "ai") continue;
        const o = ev.obj;
        if (!metaSent && "ingredients" in o && typeof o.title === "string") {
          metaSent = true;
          const title = o.title.trim() || build.fallbackTitle;
          yield {
            type: "part",
            part: "meta",
            data: {
              title,
              summary: typeof o.summary === "string" ? o.summary.trim() : "",
              servings: typeof o.servings === "string" && o.servings.trim() ? o.servings.trim() : null,
              source: "ai",
              // Early flags from the title and the idea's food; the final ones cover every ingredient.
              allergenFlags: flagsFor([title, ...build.metaNames], ctx.restrictions),
            },
          };
        }
        const ings = completeElements(o, "ingredients", "steps");
        for (; ingProcessed < ings.length; ingProcessed++) {
          const p = RawIngredient.safeParse(ings[ingProcessed]);
          if (!p.success) break;
          const ing = toIngredient(p.data, ctx, labels);
          if (ing && ingSent < 100) yield { type: "part", part: "ingredient", data: { ...ing, index: ingSent++ } };
        }
        // Steps only after every ingredient has gone out, so the order holds.
        if (ingProcessed < ings.length || !("steps" in o)) continue;
        const steps = completeElements(o, "steps", "reply");
        for (; stepProcessed < steps.length; stepProcessed++) {
          const raw = steps[stepProcessed];
          if (typeof raw !== "string") break;
          const s = toStep(raw);
          if (s && stepSent < 100) yield { type: "part", part: "step", data: { index: stepSent++, text: s } };
        }
        continue;
      }
      if (!ev.ok) {
        yield { type: "done", result: { ok: false, reason: ev.reason, reply: failReply(ev.reason, failure) } };
        return;
      }
      const result = toRecipeResult(ev.value, build);
      if (!result.ok) {
        log({ event: "ai.error", task, reason: "why" in result ? result.why : "unusable recipe" });
        yield { type: "done", result: { ok: false, reason: "failed", reply: failure } };
        return;
      }
      const r = result.recipe;
      // Whatever wasn't streamed is sent now, from the validated answer (authoritative).
      if (!metaSent) {
        yield { type: "part", part: "meta", data: { title: r.title, summary: r.summary, servings: r.servings, source: r.source, allergenFlags: r.allergenFlags } };
      }
      for (let i = ingSent; i < r.ingredients.length; i++) yield { type: "part", part: "ingredient", data: { ...r.ingredients[i], index: i } };
      for (let i = stepSent; i < r.steps.length; i++) yield { type: "part", part: "step", data: { index: i, text: r.steps[i] } };
      yield { type: "part", part: "basics", data: { basics: r.basicsAssumed, note: basicsNote(r.basicsAssumed) } };
      yield { type: "done", result: { ...result, reply: result.reply || build.defaultReply(r.title) } };
      return;
    }
    yield { type: "done", result: { ok: false, reason: "failed", reply: failure } };
  }

  function streamRecipe(input: RecipeInput): AsyncGenerator<RecipeEvent> {
    const idea = input.meal.idea;
    const build: StreamBuild = {
      ctx: input,
      labels: labelMaps(input).toId,
      mealId: input.meal.mealId,
      fallbackTitle: input.meal.title,
      source: "ai",
      opId: input.refine ? `${input.refine.messageId}:recipe` : `recipe:${input.meal.mealId}`,
      ...(input.refine ? { evidence: input.refine.text } : {}),
      metaNames: idea ? [...idea.uses.map((id) => input.state.items.find((i) => i.id === id)?.name.value ?? ""), ...idea.missing] : [],
      defaultReply: (title) => (input.refine ? "Here's the updated recipe." : `Here's a recipe for ${title}.`),
    };
    return recipeStream("recipe", RECIPE_INSTRUCTIONS, renderRecipeRequest(input, now()), build, RECIPE_FAILURE_REPLY);
  }

  async function readPastedRecipe(input: PastedRecipeInput): Promise<RecipeResult> {
    if (input.text.length > PASTE_MAX) return { ok: false, reason: "failed", reply: PASTE_TOO_LONG_REPLY };
    if (!input.text.trim()) return { ok: false, reason: "failed", reply: PASTE_FAILURE_REPLY };
    const firstLine = input.text.trim().split("\n")[0].trim();
    const build: StreamBuild = {
      ctx: input,
      labels: labelMaps(input).toId,
      mealId: input.meal.mealId,
      fallbackTitle: input.meal.title,
      source: "user",
      opId: `${input.messageId}:recipe`,
      evidence: firstLine,
      pastedText: input.text,
      metaNames: [],
      defaultReply: (title) => `Saved your recipe for ${title}.`,
    };
    return collectRecipe(recipeStream("recipe-paste", PASTED_RECIPE_INSTRUCTIONS, renderPastedRequest(input, now()), build, PASTE_FAILURE_REPLY));
  }

  return {
    streamMealIdeas,
    generateMealIdeas: (input) => collectIdeas(streamMealIdeas(input)),
    streamRecipe,
    generateRecipe: (input) => collectRecipe(streamRecipe(input)),
    readPastedRecipe,
  };
}

interface StreamBuild extends RecipeBuild {
  /** Names known before the recipe streams (the idea's food), for the early flags. */
  metaNames: string[];
  defaultReply: (title: string) => string;
}

export async function collectIdeas(events: AsyncGenerator<IdeasEvent>): Promise<IdeasResult> {
  for await (const e of events) if (e.type === "done") return e.result;
  return { ok: false, reason: "failed", reply: IDEAS_FAILURE_REPLY };
}

export async function collectRecipe(events: AsyncGenerator<RecipeEvent>): Promise<RecipeResult> {
  for await (const e of events) if (e.type === "done") return e.result;
  return { ok: false, reason: "failed", reply: RECIPE_FAILURE_REPLY };
}
