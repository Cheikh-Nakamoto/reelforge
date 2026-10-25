import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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

    const bad = await client.callTool({ name: "studio_status", arguments: { project: "does-not-exist" } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
  }
});
