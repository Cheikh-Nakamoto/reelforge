#!/usr/bin/env node
/**
 * studio MCP server (stdio). Every computation is local (FFmpeg, whisper.cpp, u2net, HyperFrames); the client LLM
 * reviews the proposals (cut plan, beats) and the QA contact sheets, and decides.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { doctor, formatChecks } from "./doctor.js";
import { getJob, projectJobs, startJob, type Job } from "./jobs.js";
import { continuePipeline, createProject, listProjects, openProject, status } from "./pipeline.js";
import { Project, readJson } from "./lib/project.js";
import { listStyles } from "./lib/style.js";
import { applyCompose, proposeCompose, setBeats } from "./steps/compose.js";
import { applyCut, proposeCut } from "./steps/cut.js";
import type { CutPlan } from "./steps/cutplan.js";
import { matteSurvey } from "./steps/matte.js";
import { audio } from "./steps/audio.js";
import { render } from "./steps/render.js";
import { qa } from "./steps/qa.js";

const server = new McpServer({ name: "studio", version: "0.1.0" });

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const text = (t: string): { content: Content[] } => ({ content: [{ type: "text", text: t }] });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));
const image = (path: string): Content => ({ type: "image", data: readFileSync(path).toString("base64"), mimeType: "image/png" });

/** Wrap a handler so errors come back as tool errors the LLM can read, not protocol failures. */
function safe<A>(fn: (a: A) => Promise<{ content: Content[] }>) {
  return async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Erreur : ${(e as Error).message}` }], isError: true };
    }
  };
}

const jobView = (j: Job) => ({ job: j.id, label: j.label, status: j.status, error: j.error, log: j.log.slice(-25), result: j.result });

const ProjectArg = z.string().describe("Project name (from studio_create_project or studio_list_projects)");
const Formats = z.array(z.enum(["16x9", "9x16"])).optional().describe("Output formats, default both");

server.registerTool("studio_list_styles", {
  description: "List the editing styles (styles/*.yaml): fonts, colours, rhythm, animation types.",
}, safe(async () => json(listStyles())));

server.registerTool("studio_doctor", {
  description: "Check the local toolchain (Node, FFmpeg, Parakeet, whisper.cpp, matting weights, Chrome, styles) and say how to fix what is missing.",
}, safe(async () => text(formatChecks(await doctor()))));

server.registerTool("studio_list_projects", {
  description: "List projects in work/.",
}, safe(async () => json(listProjects())));

server.registerTool("studio_create_project", {
  description:
    "Start a project from a face-cam rush: ingest (rotation, CFR, normalization) then word-level transcription " +
    "(Parakeet or whisper.cpp, local). Runs as a background job. Poll studio_status.",
  inputSchema: {
    source: z.string().describe("Path to the rush (mp4/mov/mkv)"),
    style: z.string().describe("Style name, see studio_list_styles"),
    name: z.string().optional().describe("Project name, default derived from the file name"),
    engine: z.enum(["parakeet", "whisper"]).optional().describe(
      "ASR: parakeet (default; accurate word times, fast) or whisper (better French spelling, word times drift up to 0.7 s)",
    ),
    language: z.string().optional().describe("Whisper only: spoken language ISO code, default fr"),
    model: z.string().optional().describe("Whisper only: whisper.cpp model, default large-v3-turbo"),
  },
}, safe(async (a) => {
  const name = a.name ?? Project.nameFromSource(a.source);
  const job = startJob(name, "create", async (log) => {
    await createProject(a.source, a.style, { name, engine: a.engine, language: a.language, model: a.model, log });
    const p = await proposeCut(openProject(name).project, openProject(name).style);
    log(`[cut] plan proposé : ${p.plan.sourceDuration}s → ${p.plan.keptDuration}s`);
    return { project: name, next: "studio_cut_review" };
  });
  return json({ project: name, ...jobView(job), next: "Poll studio_status, then studio_cut_review." });
}));

server.registerTool("studio_status", {
  description: "Project state: which steps are cached, the cut plan status, and the latest background jobs with their logs.",
  inputSchema: { project: ProjectArg, job: z.string().optional().describe("A job id to inspect") },
}, safe(async (a) => {
  if (a.job) {
    const j = getJob(a.job);
    if (!j) throw new Error(`Unknown job ${a.job}`);
    return json(jobView(j));
  }
  const jobs = projectJobs(a.project).slice(-3).map(jobView);
  try {
    return json({ ...status(openProject(a.project).project), jobs });
  } catch (e) {
    if (jobs.length) return json({ project: a.project, jobs });
    throw e;
  }
}));

server.registerTool("studio_cut_review", {
  description:
    "Show the proposed cut plan: transcript with removed words struck through (fillers, stutters, failed takes, " +
    "tightened pauses) and every word id. Optionally edit it: `remove` / `restore` word ids, change pause tightening. " +
    "Edits accumulate. Read it like an editor: keep the best take, keep meaning intact.",
  inputSchema: {
    project: ProjectArg,
    remove: z.array(z.string()).optional().describe("Word ids to cut (e.g. w12)"),
    restore: z.array(z.string()).optional().describe("Word ids to keep despite the heuristics"),
    minPause: z.number().optional().describe("Pauses longer than this (s) are tightened"),
    keep: z.number().optional().describe("Breath kept on each side of a tightened pause (s)"),
    words: z.boolean().optional().describe("Also return the word list with ids and times (for precise edits)"),
  },
}, safe(async (a) => {
  const { project, style } = openProject(a.project);
  const edited = a.remove || a.restore || a.minPause !== undefined || a.keep !== undefined;
  let md: string;
  if (edited) md = (await proposeCut(project, style, a)).markdown;
  else md = readFileSync(project.path("cut", "cutplan.md"), "utf8");
  const out: Content[] = [{ type: "text", text: md }];
  if (a.words) {
    const plan = readJson<CutPlan>(project.path("cut", "cutplan.json"));
    out.push({ type: "text", text: plan.words.map((w) => `${w.id}\t${w.start.toFixed(2)}\t${w.keep ? "" : "✂ "}${w.text}`).join("\n") });
  }
  return { content: out };
}));

server.registerTool("studio_cut_apply", {
  description: "Approve the cut plan and render cut.mp4 (frame-accurate, 12 ms audio fades). Then run studio_produce.",
  inputSchema: { project: ProjectArg },
}, safe(async (a) => {
  const { project } = openProject(a.project);
  const r = await applyCut(project);
  return json({ cutVideo: r.video, words: r.words.length, cached: r.cached, next: "studio_produce" });
}));

server.registerTool("studio_produce", {
  description:
    "Background job: matte survey → beats proposal (behind-words matted at full rate, unstable ones replaced) → " +
    "compose → audio → render → QA. Stops nowhere; to review beats first use studio_beats instead, then call this " +
    "again (it keeps existing beats). Poll studio_status, then studio_qa.",
  inputSchema: {
    project: ProjectArg,
    formats: Formats,
    quality: z.enum(["draft", "standard", "high"]).optional(),
    repropose: z.boolean().optional().describe("Recompute beats even if beats.json exists (drops edits)"),
  },
}, safe(async (a) => {
  const { project, style } = openProject(a.project);
  const job = startJob(a.project, "produce", (log) => continuePipeline(project, style, { formats: a.formats, quality: a.quality, repropose: a.repropose, log }));
  return json(jobView(job));
}));

server.registerTool("studio_beats", {
  description:
    "Review or edit the motion design plan (beats.json): caption groups, 1–3 words behind the subject, motion " +
    "graphics (counter, callout, underline, badge, list) and sfx cues, all in cut-timeline seconds. " +
    "`action: propose` computes it (background job: mattes candidate windows), `show` returns it, `set` replaces it " +
    "with your edited JSON (validated).",
  inputSchema: {
    project: ProjectArg,
    action: z.enum(["propose", "show", "set"]),
    beats: z.any().optional().describe("For action=set: the full beats object as returned by show"),
  },
}, safe(async (a) => {
  const { project, style } = openProject(a.project);
  if (a.action === "propose") {
    const job = startJob(a.project, "beats", async (log) => {
      if (style.behind.enabled) await matteSurvey(project);
      return (await proposeCompose(project, style, log)).summary;
    });
    return json(jobView(job));
  }
  if (a.action === "set") return text(setBeats(project, a.beats).summary);
  return json(readJson(project.path("compose", "beats.json")));
}));

server.registerTool("studio_step", {
  description: "Re-run one late step in the background (compose | audio | render | qa), e.g. after editing beats or a style.",
  inputSchema: { project: ProjectArg, step: z.enum(["compose", "audio", "render", "qa"]), formats: Formats, force: z.boolean().optional() },
}, safe(async (a) => {
  const { project, style } = openProject(a.project);
  const job = startJob(a.project, a.step, async (log) => {
    const formats = a.formats;
    if (a.step === "compose") return applyCompose(project, style, { formats, force: a.force });
    if (a.step === "audio") return (await audio(project, style, { force: a.force })).report;
    const r = await render(project, { formats, force: a.force && a.step === "render", onProgress: (l) => l && log(l) });
    return a.step === "qa" ? qa(project, style, r.outputs) : r.outputs;
  });
  return json(jobView(job));
}));

server.registerTool("studio_qa", {
  description:
    "QA of the rendered exports: contact sheets (1 frame per second, timestamps burnt in) returned as images for you to " +
    "inspect, loudness (target -16 LUFS), duration, and warnings (unstable matte, lint/check). Look at every sheet: " +
    "captions legible and off the face, behind-words partly hidden by the head, graphics clear of the subject.",
  inputSchema: { project: ProjectArg, mattePreview: z.boolean().optional().describe("Also return the cutout preview over magenta") },
}, safe(async (a) => {
  const { project } = openProject(a.project);
  const r = readJson<Awaited<ReturnType<typeof qa>>>(project.path("qa", "qa.json"));
  const content: Content[] = [{ type: "text", text: JSON.stringify({ files: r.files, warnings: r.warnings }, null, 2) }];
  for (const f of r.files) content.push(image(f.sheet));
  if (a.mattePreview && r.mattePreview) content.push(image(r.mattePreview));
  return { content };
}));

await server.connect(new StdioServerTransport());
