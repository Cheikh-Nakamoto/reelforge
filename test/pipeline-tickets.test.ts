import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// WORK_DIR is read once, when lib/project.ts loads: set it before importing anything of studio.
const work = mkdtempSync(join(tmpdir(), "studio-work-"));
process.env.STUDIO_WORK_DIR = work;
const { writeDefaultTickets } = await import("../src/pipeline.js");
const { readTickets, recordQa, ticketsDir } = await import("../src/tickets.js");

const project = (name: string, extra: Record<string, unknown> = {}) => {
  mkdirSync(join(work, name), { recursive: true });
  writeFileSync(join(work, name, "project.json"), JSON.stringify({ name, source: `/x/${name}.mp4`, style: "cinematic", createdAt: "2026-10-25T00:00:00Z", ...extra }));
};
const slugs = (name: string) => readTickets(ticketsDir(name)).map((t) => `${t.id} ${t.slug} ${t.status}`);

test("a new project gets the default tickets once, with its recipe's brief", () => {
  project("solo", { recipe: "demo-produit", formats: ["9x16"] });
  writeDefaultTickets("solo");
  assert.deepEqual(slugs("solo"), ["0001 cut ouvert", "0002 beats ouvert", "0003 produce ouvert"]);
  assert.match(readFileSync(join(ticketsDir("solo"), "0001-cut.md"), "utf8"), /Brief de la recette/);
  writeFileSync(join(ticketsDir("solo"), "0002-beats.md"), readFileSync(join(ticketsDir("solo"), "0002-beats.md"), "utf8").replace("# Motion design", "# Édité"));
  writeDefaultTickets("solo");
  assert.match(readFileSync(join(ticketsDir("solo"), "0002-beats.md"), "utf8"), /# Édité/, "an existing split is never rewritten");
});

test("an assembly gets a cut review per part before its project exists", () => {
  writeDefaultTickets("joined", {
    name: "joined", style: "tech-explainer", transitions: ["smoothleft"], transitionDuration: 0.45,
    parts: [{ source: "/rushs/Intro.mp4" }, { project: "demo" }, { source: "/rushs/b.mp4", name: "explication" }],
  });
  assert.deepEqual(slugs("joined").slice(0, 4), ["0001 cut-intro ouvert", "0002 cut-demo ouvert", "0003 cut-explication ouvert", "0004 assemble ouvert"]);
});

test("a QA with warnings adds the correction round, a clean one adds nothing, closed tickets stay", () => {
  project("rounds", { formats: ["9x16", "16x9"] });
  writeDefaultTickets("rounds");
  // The produce ticket (0003) is the open one rendering 9x16.
  assert.deepEqual(recordQa("rounds", ["9x16"], ["9x16: true peak -0.4 dBFS (> -1).", "16x9: durée 3 s ≠ montage 2 s."]).map((t) => t.slug), ["corrections-1"]);
  const round = readTickets(ticketsDir("rounds")).find((t) => t.slug === "corrections-1")!;
  assert.equal(round.id, "0005");
  assert.deepEqual(round.dependsOn, ["0003"]);
  const ctx = round.sections.map((s) => s.body).join("");
  assert.match(ctx, /true peak/);
  assert.doesNotMatch(ctx, /durée 3 s/, "another format's warning is not this round's");

  assert.deepEqual(recordQa("rounds", ["16x9"], []).map((t) => t.slug), []);
  assert.equal(readTickets(ticketsDir("rounds")).length, 5);
});
