import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { closeTicket, nextTicket, parseTicket, planTickets, readTickets, renderTicket, writeTickets, type Ticket } from "../src/tickets.js";
import { ROOT } from "../src/lib/project.js";

const MD = `---
id: 0003
statut: ouvert
dépend de: 0001, 0002
checkpoint: utilisateur
---

# Revue du plan de coupe

## Contexte

Projet \`demo\`, style \`cinematic\`.

## Terminé quand

- [ ] Plan approuvé.
- [x] Mots relus.
`;

test("a ticket reads and writes back without loss", () => {
  const t = parseTicket(MD);
  assert.equal(t.id, "0003");
  assert.equal(t.status, "ouvert");
  assert.deepEqual(t.dependsOn, ["0001", "0002"]);
  assert.equal(t.checkpoint, "utilisateur");
  assert.equal(t.title, "Revue du plan de coupe");
  assert.deepEqual(t.sections.map((s) => s.heading), ["Contexte", "Terminé quand"]);
  assert.equal(renderTicket(t), MD);
  assert.deepEqual(parseTicket(renderTicket(t)), t);
});

test("a ticket with no dependency writes the dash", () => {
  const t = parseTicket(MD.replace("0001, 0002", "—").replace("checkpoint: utilisateur\n", ""));
  assert.deepEqual(t.dependsOn, []);
  assert.equal(t.checkpoint, undefined);
  assert.match(renderTicket(t), /^dépend de: —$/m);
  assert.doesNotMatch(renderTicket(t), /checkpoint/);
});

const devDir = join(ROOT, ".scratch", "tickets");
test("every development ticket of .scratch/tickets reads and writes back unchanged", { skip: !existsSync(devDir) }, () => {
  const files = readdirSync(devDir).filter((f) => /^\d{4}-.+\.md$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) {
    const md = readFileSync(join(devDir, f), "utf8");
    const t = parseTicket(md);
    assert.equal(t.id, f.slice(0, 4), f);
    assert.ok(t.status === "ouvert" || t.status === "fait", f);
    assert.ok(t.title.length > 0, f);
    assert.ok(t.sections.some((s) => s.heading === "Terminé quand"), f);
    assert.equal(renderTicket(t), md, f);
  }
});

const shape = (ts: Ticket[]) => ts.map((t) => [t.id, t.slug, t.dependsOn.join(","), t.checkpoint ?? ""].join(" "));
const body = (t: Ticket) => t.sections.map((s) => s.body).join("\n");

test("a simple project with two formats: cut, beats, produce, one format ticket", () => {
  const ts = planTickets({ meta: { name: "demo", style: "cinematic", recipe: "interview", formats: ["9x16", "16x9"] }, brief: "Garder les silences." });
  assert.deepEqual(shape(ts), [
    "0001 cut  utilisateur",
    "0002 beats 0001 ",
    "0003 produce 0002 utilisateur",
    "0004 format-16x9 0003 ",
  ]);
  for (const t of ts) {
    assert.equal(t.status, "ouvert");
    const ctx = t.sections.find((s) => s.heading === "Contexte")!.body;
    for (const want of ["`demo`", "`cinematic`", "`interview`", "Garder les silences.", "9x16", "skills/studio/SKILL.md"]) assert.ok(ctx.includes(want), `${t.slug}: ${want}`);
    assert.match(t.sections.find((s) => s.heading === "Terminé quand")!.body, /^- \[ \] /m, t.slug);
  }
  assert.match(body(ts[0]), /cutplan\.md/);
  assert.match(body(ts[1]), /beats\.json/);
  assert.match(body(ts[2]), /qa\.json/);
  assert.match(body(ts[2]), /9x16/);
  assert.match(body(ts[3]), /16x9/);
});

test("a project with no formats set plans both, 9:16 first", () => {
  const ts = planTickets({ meta: { name: "demo", style: "reel-dynamique" } });
  assert.deepEqual(ts.map((t) => t.slug), ["cut", "beats", "produce", "format-16x9"]);
});

test("an assembly of three parts: a cut per part, then assemble, then the simple chain", () => {
  const ts = planTickets({
    meta: { name: "short", style: "tech-explainer", assembly: true, formats: ["9x16"] },
    parts: ["intro", "demo", "explication"],
  });
  assert.deepEqual(shape(ts), [
    "0001 cut-intro  utilisateur",
    "0002 cut-demo  utilisateur",
    "0003 cut-explication  utilisateur",
    "0004 assemble 0001,0002,0003 ",
    "0005 beats 0004 ",
    "0006 produce 0005 utilisateur",
  ]);
  assert.match(body(ts[1]), /`demo`/);
  assert.match(body(ts[3]), /studio_assemble/);
});

test("corrections: none without warnings, one round per QA with warnings, three rounds at most", () => {
  const meta = { name: "demo", style: "cinematic", formats: ["9x16" as const] };
  assert.deepEqual(planTickets({ meta, qa: [{ ticket: "0003", warnings: [] }] }).map((t) => t.slug), ["cut", "beats", "produce"]);

  const one = planTickets({ meta, qa: [{ ticket: "0003", warnings: ["9x16: true peak -0.4 dBFS (> -1)."] }] });
  assert.deepEqual(shape(one).slice(3), ["0004 corrections-1 0003 "]);
  assert.match(body(one[3]), /true peak -0\.4/);

  const w = ["Énergie : trop calme."];
  const three = planTickets({ meta, qa: [{ ticket: "0003", warnings: w }, { ticket: "0004", warnings: w }, { ticket: "0005", warnings: w }] });
  assert.deepEqual(shape(three).slice(3), ["0004 corrections-1 0003 ", "0005 corrections-2 0004 ", "0006 corrections-3 0005 "]);
  assert.match(body(three[5]), /rapporte/i);
  assert.doesNotMatch(body(three[4]), /rapporte/i);

  const four = planTickets({ meta, qa: [...[3, 4, 5, 6].map((n) => ({ ticket: `000${n}`, warnings: w }))] });
  assert.equal(four.filter((t) => t.slug.startsWith("corrections")).length, 3, "no fourth round");

  const clean = planTickets({ meta, qa: [{ ticket: "0003", warnings: w }, { ticket: "0004", warnings: [] }] });
  assert.equal(clean.filter((t) => t.slug.startsWith("corrections")).length, 1, "a clean QA ends the rounds");
});

const tk = (id: string, status: "ouvert" | "fait", dependsOn: string[] = [], checkpoint?: string): Ticket => ({
  id, slug: `t${id}`, title: `T${id}`, status, dependsOn, ...(checkpoint ? { checkpoint } : {}), preamble: "", sections: [],
});

test("nextTicket: the first open ticket whose dependencies are done, a checkpoint included", () => {
  assert.equal(nextTicket([tk("0001", "fait"), tk("0002", "ouvert", ["0003"]), tk("0003", "ouvert", ["0001"])])?.id, "0003");
  assert.equal(nextTicket([tk("0001", "ouvert", [], "utilisateur"), tk("0002", "ouvert")])?.id, "0001", "a ready checkpoint is not skipped");
  assert.equal(nextTicket([tk("0001", "ouvert", [], "utilisateur"), tk("0002", "ouvert", ["0001"])])?.id, "0001");
  assert.equal(nextTicket([tk("0001", "fait"), tk("0002", "fait")]), null);
  assert.equal(nextTicket([tk("0001", "ouvert", ["0002"]), tk("0002", "ouvert", ["0001"])]), null);
});

test("closeTicket marks the ticket done and writes its result; it can be read back from disk with the README", () => {
  const [cut, beats] = planTickets({ meta: { name: "demo", style: "cinematic", formats: ["9x16"] } });
  const done = closeTicket(cut, "Plan approuvé : 42 s → 31 s.");
  assert.equal(done.status, "fait");
  assert.equal(cut.status, "ouvert", "the input is not mutated");
  assert.equal(done.sections.at(-1)!.heading, "Résultat");
  assert.equal(done.sections.at(-1)!.body.trim(), "Plan approuvé : 42 s → 31 s.");
  assert.equal(closeTicket(done, "Autre.").sections.filter((s) => s.heading === "Résultat").length, 1, "closing twice replaces the result");

  const dir = mkdtempSync(join(tmpdir(), "tickets-"));
  writeTickets(dir, [done, beats]);
  assert.ok(existsSync(join(dir, "0001-cut.md")));
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  assert.match(readme, /\| 0001 \| \[.+\]\(0001-cut\.md\) \| fait \| — \|/);
  assert.match(readme, /\| 0002 \| \[.+\]\(0002-beats\.md\) \| ouvert \| 0001 \|/);
  const back = readTickets(dir);
  assert.deepEqual(back, [done, beats]);
  assert.equal(nextTicket(back)?.slug, "beats");
  assert.deepEqual(readTickets(join(dir, "missing")), []);
});
