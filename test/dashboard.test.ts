import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("the dashboard serves projects, files with ranges, and nothing outside a project", async () => {
  const work = mkdtempSync(join(tmpdir(), "studio-dash-"));
  process.env.STUDIO_WORK_DIR = work;
  mkdirSync(join(work, "demo", "07-render"), { recursive: true });
  writeFileSync(join(work, "demo", "project.json"), JSON.stringify({ name: "demo", source: "x.mp4", style: "tech-explainer", createdAt: "2026-01-01" }));
  writeFileSync(join(work, "demo", "07-render", "demo_9x16.mp4"), Buffer.alloc(5000, 1));
  writeFileSync(join(work, "demo", "events.jsonl"), JSON.stringify({ t: "2026-01-01T00:00:00Z", kind: "tool", source: "mcp", tool: "studio_cut_apply", message: "studio_cut_apply" }) + "\n");
  const { startDashboard, stopDashboard } = await import("../src/dashboard.js");
  const url = await startDashboard(4699);
  try {
  const list = await (await fetch(`${url}api/projects`)).json();
  assert.deepEqual(list.map((p: { name: string }) => p.name), ["demo"]);
  const rep = await (await fetch(`${url}api/projects/demo`)).json();
  assert.equal(rep.renders[0].format, "9x16");
  assert.equal(rep.events[0].tool, "studio_cut_apply");
  const part = await fetch(`${url}files/demo/07-render/demo_9x16.mp4`, { headers: { range: "bytes=0-99" } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(`${url}files/demo/..%2F..%2Fetc%2Fpasswd`)).status, 404);
  assert.match(await (await fetch(url)).text(), /studio · atelier/);
  } finally {
    await stopDashboard();
  }
});
