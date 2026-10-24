/**
 * End-to-end run through the MCP server, driving it the way an agent does: create → review the cut (remove words by
 * id) → apply → propose beats → produce → QA. Slow (several minutes of CPU); not part of `npm test`.
 *
 *   npx tsx scripts/mcp-e2e.ts rushs/test-synth.mp4 [style] [project-name]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [source = "rushs/test-synth.mp4", style = "tech-explainer", name = "mcp-e2e"] = process.argv.slice(2);
const server = new URL("../dist/mcp.js", import.meta.url).pathname;

type Content = { type: string; text?: string; data?: string };
const client = new Client({ name: "studio-e2e", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server] }));
const t0 = Date.now();
const log = (m: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s  ${m}`);

async function call(tool: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 600_000 });
  const content = r.content as Content[];
  if (r.isError) throw new Error(`${tool}: ${content[0]?.text}`);
  return content;
}
const json = (c: Content[]) => JSON.parse(c[0].text!);

/** Poll studio_status until the job ends, as an agent would. */
async function wait(job: string) {
  for (;;) {
    const s = json(await call("studio_status", { project: name, job }));
    if (s.status !== "running") {
      if (s.status === "error") throw new Error(`job ${job}: ${s.error}`);
      log(`job ${s.label} done`);
      return s;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

try {
  const created = json(await call("studio_create_project", { source, style, name }));
  log(`create → job ${created.job}`);
  await wait(created.job);

  const review = await call("studio_cut_review", { project: name, words: true });
  // The editor's pass: words the ASR heard for a filler ("Hut.", "Heu") go.
  const fillers = review[1].text!.split("\n").filter((l) => /\t(Hut|Heu|Euh)\b/i.test(l)).map((l) => l.split("\t")[0]);
  log(`cut review: removing ${fillers.join(", ") || "nothing"}`);
  if (fillers.length) await call("studio_cut_review", { project: name, remove: fillers });
  const applied = json(await call("studio_cut_apply", { project: name }));
  log(`cut applied: ${applied.words} words`);

  const beatsJob = json(await call("studio_beats", { project: name, action: "propose" }));
  const beats = await wait(beatsJob.job);
  log(`beats:\n${beats.result}`);

  const prod = json(await call("studio_produce", { project: name, formats: ["9x16"], quality: "draft" }));
  await wait(prod.job);

  const qa = await call("studio_qa", { project: name, mattePreview: true });
  const report = JSON.parse(qa[0].text!);
  const images = qa.filter((c) => c.type === "image").length;
  log(`qa: ${report.files.map((f: { format: string; loudness: { integrated: number } }) => `${f.format} ${f.loudness.integrated} LUFS`).join(", ")}; ${images} image(s); warnings: ${report.warnings.length ? report.warnings.join(" | ") : "none"}`);
  if (!images) throw new Error("studio_qa returned no contact sheet");
  log("OK");
} finally {
  await client.close();
}
