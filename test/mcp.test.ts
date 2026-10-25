import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = new URL("../dist/mcp.js", import.meta.url).pathname;

test("the MCP server exposes the pipeline tools", { skip: !existsSync(SERVER) && "run npm run build first" }, async () => {
  const client = new Client({ name: "studio-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    for (const n of ["studio_create_project", "studio_cut_review", "studio_cut_apply", "studio_beats", "studio_produce", "studio_qa", "studio_status", "studio_reference"]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }
    const styles = await client.callTool({ name: "studio_list_styles", arguments: {} });
    assert.match((styles.content as { text: string }[])[0].text, /"name": "cinematic"/);

    const { prompts } = await client.listPrompts();
    const pnames = prompts.map((p) => p.name);
    for (const n of ["questionnaire", "demo-produit", "reel-viral", "storytelling"]) assert.ok(pnames.includes(n), `missing prompt ${n}`);
    const p = await client.getPrompt({ name: "demo-produit", arguments: { rushes: "rushs/a.mp4" } });
    assert.match((p.messages[0].content as { text: string }).text, /recipe: "demo-produit"/);

    // Tickets: the procedure comes from skills/ticket/SKILL.md, served with the tools in place of the files.
    for (const n of ["ticket", "tickets"]) assert.ok(pnames.includes(n), `missing prompt ${n}`);
    const procedure = readFileSync(new URL("../skills/ticket/SKILL.md", import.meta.url), "utf8");
    const step1 = /^1\. .*$/m.exec(procedure)?.[0];
    assert.ok(step1, "skills/ticket/SKILL.md has numbered steps");
    const one = (await client.getPrompt({ name: "ticket", arguments: { project: "demo" } })).messages[0].content as { text: string };
    assert.match(one.text, /studio_ticket_next/);
    assert.match(one.text, /studio_ticket_close/);
    assert.ok(one.text.includes(step1), "the ticket prompt serves the procedure itself");
    const loop = (await client.getPrompt({ name: "tickets", arguments: { project: "demo" } })).messages[0].content as { text: string };
    assert.match(loop.text, /sous-agent/);
    assert.match(loop.text, /checkpoint/i);
    assert.match(loop.text, /mcp__studio__ticket demo/);

    const bad = await client.callTool({ name: "studio_status", arguments: { project: "does-not-exist" } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
  }
});

test("a project's tickets through MCP: propose, next, close, set, journal", { skip: !existsSync(SERVER) && "run npm run build first" }, async () => {
  const work = mkdtempSync(join(tmpdir(), "studio-work-"));
  mkdirSync(join(work, "demo"));
  writeFileSync(join(work, "demo", "project.json"), JSON.stringify({ name: "demo", source: "/x/demo.mp4", style: "cinematic", createdAt: "2026-10-25T00:00:00Z", formats: ["9x16"] }));
  const client = new Client({ name: "studio-test", version: "0" });
  const env = { ...process.env, STUDIO_WORK_DIR: work } as Record<string, string>;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    return { error: r.isError === true, text: (r.content as { text: string }[])[0].text };
  };
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["studio_tickets", "studio_ticket_next", "studio_ticket_close"]) assert.ok(names.includes(n), `missing tool ${n}`);

    const proposed = await call("studio_tickets", { project: "demo", action: "propose" });
    assert.equal(proposed.error, false, proposed.text);
    assert.match(proposed.text, /\| 0001 \| \[Revue du plan de coupe\]/);
    assert.ok(existsSync(join(work, "demo", "tickets", "0001-cut.md")));

    const first = JSON.parse((await call("studio_ticket_next", { project: "demo" })).text);
    assert.equal(first.id, "0001");
    assert.equal(first.checkpoint, "utilisateur");
    assert.match(first.markdown, /^---\nid: 0001\n/);

    const closed = await call("studio_ticket_close", { project: "demo", id: "0001", result: "Plan approuvé : 42 s → 31 s." });
    assert.equal(closed.error, false, closed.text);
    assert.match(readFileSync(join(work, "demo", "tickets", "0001-cut.md"), "utf8"), /statut: fait[\s\S]*## Résultat\n\nPlan approuvé/);
    assert.match(readFileSync(join(work, "demo", "tickets", "README.md"), "utf8"), /\| 0001 \| .* \| fait \|/);
    const second = JSON.parse((await call("studio_ticket_next", { project: "demo" })).text);
    assert.equal(second.id, "0002");
    assert.equal(second.checkpoint, null);

    // A re-proposal keeps the closed ticket.
    await call("studio_tickets", { project: "demo", action: "propose" });
    assert.match(readFileSync(join(work, "demo", "tickets", "0001-cut.md"), "utf8"), /Plan approuvé/);

    const shown = await call("studio_tickets", { project: "demo", action: "show" });
    assert.match(shown.text, /id: 0002/);

    const cycle = await call("studio_tickets", { project: "demo", action: "set", tickets: [
      { id: "0002", title: "A", dependsOn: ["0003"] },
      { id: "0003", title: "B", dependsOn: ["0002"] },
    ] });
    assert.equal(cycle.error, true);
    assert.match(cycle.text, /cycle/i);
    const unknown = await call("studio_tickets", { project: "demo", action: "set", tickets: [{ id: "0002", title: "A", dependsOn: ["0009"] }] });
    assert.equal(unknown.error, true);

    const set = await call("studio_tickets", { project: "demo", action: "set", tickets: [
      { id: "0002", title: "Beats et rendu", dependsOn: ["0001"], context: "Tout d'un coup.", done: ["Rendu fait."] },
    ] });
    assert.equal(set.error, false, set.text);
    assert.deepEqual(readdirSync(join(work, "demo", "tickets")).filter((f) => /^\d{4}/.test(f)).sort(), ["0001-cut.md", "0002-beats-et-rendu.md"]);

    const reopened = await call("studio_ticket_close", { project: "demo", id: "0002", status: "ouvert", result: "Interrompu.", reprise: "Beats faits, rendu à lancer." });
    assert.equal(reopened.error, false, reopened.text);
    assert.match(readFileSync(join(work, "demo", "tickets", "0002-beats-et-rendu.md"), "utf8"), /statut: ouvert[\s\S]*## Reprise\n\nBeats faits/);
    await call("studio_ticket_close", { project: "demo", id: "0002", result: "Rendu fait." });
    const end = JSON.parse((await call("studio_ticket_next", { project: "demo" })).text);
    assert.equal(end.id, null);
    assert.match(end.reason, /fait/);

    const events = readFileSync(join(work, "demo", "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.tool === "studio_tickets"));
    assert.ok(events.some((e) => e.kind === "ticket" && /0001/.test(e.message)));
  } finally {
    await client.close();
  }
});
