import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ROUNDS, planCampaign, rejectTicket, trialCampaign } from "../scripts/campaign.js";
import { closeTicket, nextTicket, parseTicket, renderTicket, type Ticket } from "../src/tickets.js";

const spec = { nom: "demo", produit: "`~/demo/README.md`." };
const field = (t: Ticket, k: string) => t.extra?.find(([key]) => key === k)?.[1];
const byTitle = (ts: Ticket[], re: RegExp) => ts.filter((t) => re.test(t.title));

/** Runs the loop the way loop-campagne.md does: closes every ready ticket until a checkpoint or `stop` says so. */
function runUntil(ts: Ticket[], stop: (t: Ticket) => boolean): { ts: Ticket[]; at: Ticket | null } {
  for (;;) {
    const t = nextTicket(ts);
    if (!t || t.checkpoint || stop(t)) return { ts, at: t };
    ts = ts.map((x) => (x.id === t.id ? closeTicket(x, "ok") : x));
  }
}

test("the default split follows the campaign flow, gates as maintainer checkpoints", () => {
  const ts = planCampaign(spec);
  assert.deepEqual(ts.slice(0, 9).map((t) => field(t, "agent")), [
    "product-analyst", "audience-researcher", "psych-profiler", "positioning-strategist",
    "psych-auditor", "product-critic", "devils-advocate", "general-purpose", "campaign-planner",
  ]);
  assert.deepEqual(ts.filter((t) => t.checkpoint).map((t) => t.title), ["Gate 1 : positionnement", "Gate 2 : avant rendu"]);
  assert.deepEqual(ts.slice(-3).map((t) => t.slug), ["production", "qa", "bilan"]);
  assert.equal(field(ts[0], "sortie"), "01-produit.md");
  for (const l of ["texte", "script", "visuel", "voix"]) {
    assert.deepEqual(ts.filter((t) => field(t, "livrable") === l).map((t) => field(t, "agent")).slice(1),
      ["psych-auditor", "product-critic", "devils-advocate"], l);
  }
  const voix = ts.find((t) => t.slug === "voix")!;
  const scriptEnd = ts.filter((t) => field(t, "livrable") === "script").at(-1)!;
  assert.ok(voix.dependsOn.includes(scriptEnd.id), "the voice reads the reviewed script");
  const g2 = ts.find((t) => t.slug === "gate-2")!;
  assert.equal(g2.dependsOn.length, 4);
});

test("every planned ticket survives the file format of src/tickets.ts", () => {
  for (const t of planCampaign(spec)) assert.deepEqual(parseTicket(renderTicket(t)), { ...t, slug: parseTicket(renderTicket(t)).slug });
});

test("the loop stops on gate 1 with the strategy reviewed", () => {
  const { at } = runUntil(planCampaign(spec), () => false);
  assert.equal(at?.title, "Gate 1 : positionnement");
});

test("a rejection writes a reprise and the three reviews again, and what waited now waits on them", () => {
  let ts = planCampaign(spec);
  ({ ts } = runUntil(ts, (t) => field(t, "agent") === "product-critic"));
  const critic = nextTicket(ts)!;
  const advocate = ts.find((t) => t.dependsOn.includes(critic.id))!;
  ts = rejectTicket(spec, ts, critic.id, "promesse invérifiable");
  assert.equal(ts.find((t) => t.id === advocate.id)!.status, "fait", "the rest of the round is void");
  const reprise = byTitle(ts, /^Reprise : stratégie, tour 1$/)[0];
  assert.equal(field(reprise, "agent"), "positioning-strategist");
  assert.equal(field(reprise, "sortie"), "04-positionnement.md", "the corrected version takes the file's place");
  const round = ts.filter((t) => field(t, "tour") === "1" && field(t, "rôle") === "revue");
  assert.deepEqual(round.map((t) => field(t, "agent")), ["psych-auditor", "product-critic", "devils-advocate"]);
  const gate = ts.find((t) => t.slug === "gate-1")!;
  assert.deepEqual(gate.dependsOn, [round.at(-1)!.id]);
  assert.equal(nextTicket(ts)!.id, reprise.id);
});

test(`after ${MAX_ROUNDS} rounds a rejection goes to the maintainer`, () => {
  let ts = planCampaign(spec);
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    ({ ts } = runUntil(ts, (t) => field(t, "agent") === "psych-auditor"));
    ts = rejectTicket(spec, ts, nextTicket(ts)!.id, `rejet ${round}`);
  }
  assert.equal(byTitle(ts, /^Reprise/).length, MAX_ROUNDS);
  const next = nextTicket(ts)!;
  assert.equal(next.title, "Désaccord sur stratégie : le mainteneur tranche");
  assert.equal(next.checkpoint, "mainteneur");
  assert.deepEqual(ts.find((t) => t.slug === "gate-1")!.dependsOn, [next.id]);
});

test("a gate's correction goes back through the psych audit only, then on to the plan", () => {
  let ts = planCampaign(spec);
  ({ ts } = runUntil(ts, () => false));
  const gate = nextTicket(ts)!;
  ts = rejectTicket(spec, ts, gate.id, "message clé trop vague", { refaire: "0004" });
  const added = ts.slice(-2);
  assert.deepEqual(added.map((t) => field(t, "rôle")), ["reprise", "revue"]);
  assert.equal(field(added[1], "agent"), "psych-auditor");
  assert.deepEqual(ts.find((t) => t.slug === "plan")!.dependsOn.sort(), [added[1].id, "0004"].sort());
});

test("only a review or a gate rejects", () => {
  assert.throws(() => rejectTicket(spec, planCampaign(spec), "0001", "x"), /seul une revue ou une gate/);
});

test("the trial campaign is a note, then a checkpoint on it", () => {
  const ts = trialCampaign(spec);
  assert.deepEqual(ts.map((t) => [field(t, "agent"), t.checkpoint ?? null]), [["general-purpose", null], ["general-purpose", "mainteneur"]]);
  assert.equal(runUntil(ts, () => false).at?.id, "0002");
});
