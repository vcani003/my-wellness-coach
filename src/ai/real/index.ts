/**
 * The Claude interpreter (ai.md §1, §7). One structured-output call per message.
 * Never throws (0018): an API error, timeout, refusal or unusable output becomes a plain reply
 * with `proposal: null`, so nothing changes and the buttons keep working.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ApplyResult } from "@/contracts/apply-result";
import type { InterpretRequest, InterpretResult, Interpreter } from "../interpreter";
import { BUDGET_EXHAUSTED_REPLY, budgetExhaustedReason, type BudgetReason } from "./budget";
import { modelOutputFormat, parseModelOutput } from "./model-output";
import { PROMPT_VERSION, SYSTEM_PROMPT, renderTurn } from "./prompt";
import { isSchemaTooComplex, jsonText } from "./schema-error";
import { estimateCostUsd, taskSettings, type TaskSettings } from "./settings";
import { toInterpretResult } from "./to-proposal";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

/** The one SDK call we use; injectable so tests run with a mocked client. */
export interface MessagesApi {
  create(body: CreateParams, options?: { timeout?: number }): Promise<Message>;
}

export interface UsageLog {
  event: "ai.usage";
  task: "interpret" | "reword";
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

/** One event when a call is refused because the spend limit or credit is used up (0020 N1). No secrets. */
export interface BudgetLog {
  event: "ai.budget_exhausted";
  task: "interpret" | "reword";
  reason: BudgetReason;
  status: number | undefined;
  requestId: string | null;
}

/**
 * One event when the API refuses to compile the interpret output schema and the call is retried
 * without it (ai.md §1). Means the wire schema has grown too complex: fix it, but chat keeps working.
 */
export interface SchemaFallbackLog {
  event: "ai.schema_fallback";
  task: "interpret";
  reason: string;
}

export { BUDGET_EXHAUSTED_REPLY };

export interface RealInterpreterOptions {
  messages?: MessagesApi;
  now?: () => Date;
  log?: (entry: UsageLog | BudgetLog | SchemaFallbackLog | { event: "ai.error"; task: string; reason: string }) => void;
  env?: Record<string, string | undefined>;
}

export const FAILURE_REPLY = "Sorry, I couldn't process that just now, so nothing changed. Please try again.";
export const REFUSAL_REPLY = "I can't help with that one, so nothing changed.";

/** Fallback to another Claude model on a refusal, routed by category (claude-api skill). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const OUTPUT_FORMAT = modelOutputFormat();
/**
 * Used only when the API won't compile OUTPUT_FORMAT: the same JSON is asked for in words, with
 * the exact schema, and the answer still goes through the same Zod check (parseModelOutput).
 */
export const JSON_FALLBACK_INSTRUCTIONS = `# Answer format\nReply with only the JSON object described above: no other text and no code fences. It must match this JSON Schema exactly (every key present):\n${JSON.stringify(OUTPUT_FORMAT.schema)}`;
const REWORD_INSTRUCTIONS =
  "# Rewording\nIgnore the JSON format above for this task. The app tried to save a change and some of it did not save. Rewrite the reply in Kitchen's voice so it only claims what was saved and briefly says what wasn't. Reply with the message text only.";

function sdkMessages(): MessagesApi {
  // Retries cover 429/5xx and connection errors; the timeout is per attempt.
  const client = new Anthropic({ maxRetries: 1 });
  return { create: (body, options) => client.beta.messages.create(body, options) };
}

function textOf(message: Message): string {
  return message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function createRealInterpreter(options: RealInterpreterOptions = {}): Interpreter {
  let api = options.messages;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((entry) => console.info(JSON.stringify(entry)));
  const env = options.env ?? process.env;
  /** Set once the API refuses to compile OUTPUT_FORMAT; later calls go straight to the fallback. */
  let formatRejected = false;

  async function call(
    task: "interpret" | "reword",
    settings: TaskSettings,
    body: Omit<CreateParams, "model" | "max_tokens">,
  ): Promise<Message> {
    api ??= sdkMessages();
    const started = Date.now();
    const message = await api.create(
      {
        ...body,
        model: settings.model,
        max_tokens: settings.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      },
      { timeout: settings.timeoutMs },
    );
    const u = message.usage;
    log({
      event: "ai.usage",
      task,
      promptVersion: PROMPT_VERSION,
      model: message.model,
      stopReason: message.stop_reason,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      estCostUsd: estimateCostUsd(u),
      ms: Date.now() - started,
    });
    return message;
  }

  function fail(task: string, reason: string, reply = FAILURE_REPLY): InterpretResult {
    log({ event: "ai.error", task, reason });
    return { kind: "answer", proposal: null, reply };
  }

  /** If the error means the AI budget is used up, logs it once and returns true. */
  function budgetExhausted(task: "interpret" | "reword", error: unknown): boolean {
    const reason = budgetExhaustedReason(error);
    if (!reason) return false;
    const api = error as { status?: number; requestID?: string | null };
    log({ event: "ai.budget_exhausted", task, reason, status: api.status, requestId: api.requestID ?? null });
    return true;
  }

  return {
    async interpret(req: InterpretRequest): Promise<InterpretResult> {
      const settings = taskSettings("interpret", env);
      const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
      const messages: CreateParams["messages"] = [{ role: "user", content: renderTurn(req, now()) }];
      const withoutFormat = () =>
        call("interpret", settings, {
          system: [...system, { type: "text", text: JSON_FALLBACK_INSTRUCTIONS }],
          messages,
          output_config: { effort: settings.effort },
        });
      try {
        let message: Message;
        if (formatRejected) {
          message = await withoutFormat();
        } else {
          try {
            message = await call("interpret", settings, { system, messages, output_config: { effort: settings.effort, format: OUTPUT_FORMAT } });
          } catch (error) {
            if (!isSchemaTooComplex(error)) throw error;
            // The schema is deterministic, so skip it for the rest of this instance's life.
            formatRejected = true;
            log({ event: "ai.schema_fallback", task: "interpret", reason: error instanceof Error ? error.message : String(error) });
            message = await withoutFormat();
          }
        }
        if (message.stop_reason === "refusal") return fail("interpret", "refusal", REFUSAL_REPLY);
        if (message.stop_reason === "max_tokens") return fail("interpret", "hit max_tokens");

        let json: unknown;
        try {
          json = JSON.parse(jsonText(textOf(message)));
        } catch {
          return fail("interpret", "output was not JSON");
        }
        const parsed = parseModelOutput(json);
        if (!parsed.success) return fail("interpret", `output failed the schema: ${parsed.error.message}`);

        const outcome = toInterpretResult(parsed.data, req, now());
        return outcome.ok ? outcome.result : fail("interpret", outcome.reason);
      } catch (error) {
        if (budgetExhausted("interpret", error)) return { kind: "answer", proposal: null, reply: BUDGET_EXHAUSTED_REPLY };
        return fail("interpret", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      }
    },

    /** Rewrites the reply after some operations were rejected (ai.md §1 step 4). */
    async reword(req: InterpretRequest, result: InterpretResult, applied: ApplyResult): Promise<string> {
      const fallback = plainReceipt(applied);
      const settings = taskSettings("reword", env);
      try {
        const facts = [
          `Draft reply (assumed everything saved): ${result.reply}`,
          `Saved: ${applied.applied.map((a) => a.summary.text).join("; ") || "nothing"}`,
          `Not saved: ${applied.rejected.map((r) => r.reason.text).join("; ") || "nothing"}`,
        ].join("\n");
        const message = await call("reword", settings, {
          system: [
            // Same cached prefix as interpret; the task-specific part comes after it.
            { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            { type: "text", text: REWORD_INSTRUCTIONS },
          ],
          messages: [
            { role: "user", content: `<user_message>\n${req.message.text}\n</user_message>\n\n<result>\n${facts}\n</result>` },
          ],
          output_config: { effort: settings.effort },
        });
        const text = textOf(message).trim();
        return message.stop_reason === "end_turn" && text ? text : fallback;
      } catch (error) {
        // The changes are already saved, so keep the code-built receipt and add the budget note.
        if (budgetExhausted("reword", error)) return `${fallback} ${BUDGET_EXHAUSTED_REPLY}`;
        log({ event: "ai.error", task: "reword", reason: error instanceof Error ? error.message : String(error) });
        return fallback;
      }
    },
  };
}

/** A reply built by code from the ApplyResult, used when rewording fails. */
export function plainReceipt(applied: ApplyResult): string {
  const saved = applied.applied.map((a) => a.summary.text);
  const notSaved = applied.rejected.map((r) => r.reason.text);
  const parts: string[] = [];
  if (saved.length) parts.push(`Done: ${saved.join("; ")}.`);
  if (notSaved.length) parts.push(`Not saved: ${notSaved.join("; ")}.`);
  return parts.join(" ") || "Nothing changed.";
}
