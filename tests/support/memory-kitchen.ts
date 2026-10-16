/**
 * An in-memory kitchen for unit tests: runs the real `planProposal` + `apply` with a fixed clock
 * and predictable IDs, and keeps the event log so tests can check replay == step by step.
 */
import type { Fact } from "@/contracts/common";
import type { Operation } from "@/contracts/operations";
import { ProposedChange, type PastedRange } from "@/contracts/proposed-change";
import { emptyKitchen, replay, type KitchenEntities } from "@/domains/kitchen/state";
import { planProposal, type Plan, type RevertPlan } from "@/domains/kitchen/validate";
import { buildKitchenState } from "@/domains/kitchen/read-model";
import { kitchenStream, type EventEnvelope } from "@/shared/events/types";
import { emptyProfileState, replayProfile, type ProfileState } from "@/shared/profile/state";

export const said = <T>(value: T, confidence: Fact<T>["confidence"] = "high"): Fact<T> => ({
  value,
  basis: "said",
  confidence,
});
export const inferred = <T>(value: T): Fact<T> => ({ value, basis: "inferred", confidence: "medium" });

/** Operations without `opId`: the harness numbers them. */
export type OpInput = Operation extends infer O ? (O extends Operation ? Omit<O, "opId"> & { opId?: string } : never) : never;

export interface ProposeOptions {
  actor?: string;
  via?: "chat" | "button";
  messageText?: string;
  pastedRanges?: PastedRange[];
  basedOnVersion?: number;
  staleKeys?: Set<string>;
  knownEventIds?: Set<string>;
  reverts?: Map<string, RevertPlan>;
  /** The person's today (0045 KOS1); absent = the clock's UTC date (2026-10-14). */
  today?: string;
}

export class MemoryKitchen {
  readonly kitchenId = "k1";
  kitchen: KitchenEntities = emptyKitchen();
  profiles: ProfileState = emptyProfileState();
  events: EventEnvelope[] = [];
  version = 0;
  /** State after every step, to compare with replaying the log up to that point. */
  history: { events: number; kitchen: KitchenEntities; profiles: ProfileState }[] = [];
  ideas = new Map<string, { name: string }>();
  members = new Map<string, string>([
    ["vero", "Vero"],
    ["sam", "Sam"],
  ]);
  private ids = 0;
  private minutes = 0;
  private seqs = new Map<string, number>();

  newId = () => `id-${++this.ids}`;

  propose(ops: OpInput[], opts: ProposeOptions = {}): Plan {
    const via = opts.via ?? "chat";
    this.minutes += 1;
    const now = new Date(Date.UTC(2026, 9, 14, 18, this.minutes)).toISOString();
    const n = this.ids;
    const proposal = ProposedChange.parse({
      proposalId: `p-${n}`,
      kitchenId: this.kitchenId,
      basedOnVersion: opts.basedOnVersion ?? this.version,
      source:
        via === "chat"
          ? { via: "chat", messageId: `m-${n}`, ...(opts.pastedRanges ? { pastedRanges: opts.pastedRanges } : {}) }
          : { via: "button", action: "test" },
      operations: ops.map((op, i) => ({ opId: `op-${i + 1}`, ...op })),
    });
    const plan = planProposal(proposal, {
      kitchenId: this.kitchenId,
      actorId: opts.actor ?? "vero",
      via,
      now,
      ...(opts.today ? { today: opts.today } : {}),
      changeSetId: `cs-${n}`,
      source: proposal.source,
      messageText: opts.messageText,
      members: this.members,
      kitchen: this.kitchen,
      profiles: this.profiles,
      staleKeys: opts.staleKeys ?? new Set(),
      ideas: this.ideas,
      reverts: opts.reverts ?? new Map(),
      knownEventIds: opts.knownEventIds ?? new Set(this.events.map((e) => e.id)),
      newId: this.newId,
    });
    for (const e of plan.events) {
      const seq = (this.seqs.get(e.stream) ?? 0) + 1;
      this.seqs.set(e.stream, seq);
      this.events.push({ ...e, seq });
    }
    this.kitchen = plan.kitchen;
    this.profiles = plan.profiles;
    if (plan.events.length) this.version += 1;
    this.history.push({ events: this.events.length, kitchen: this.kitchen, profiles: this.profiles });
    return plan;
  }

  /** Chat helper: evidence defaults to the whole message. */
  say(text: string, ops: OpInput[], opts: Omit<ProposeOptions, "messageText"> = {}): Plan {
    return this.propose(
      ops.map((op) => ({ evidence: text, ...op })),
      { ...opts, messageText: text },
    );
  }

  tap(ops: OpInput[], opts: Omit<ProposeOptions, "via"> = {}): Plan {
    return this.propose(ops, { ...opts, via: "button" });
  }

  replayKitchen(upTo = this.events.length): KitchenEntities {
    return replay(this.events.slice(0, upTo).filter((e) => e.stream === kitchenStream(this.kitchenId)));
  }

  replayProfiles(upTo = this.events.length): ProfileState {
    return replayProfile(this.events.slice(0, upTo).filter((e) => e.stream.startsWith("user:")));
  }

  /** KitchenState as the UI would read it. */
  state() {
    return buildKitchenState(this.kitchen, {
      kitchenId: this.kitchenId,
      version: this.version,
      names: this.members,
      restrictions: Object.values(this.profiles.restrictions),
    });
  }

  item(name: string) {
    return Object.values(this.kitchen.items).find((i) => i.name.value === name);
  }
}
