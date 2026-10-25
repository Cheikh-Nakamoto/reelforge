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
import { startDashboard } from "./dashboard.js";
import { listRecipes, loadQuestionnaire, recipeFromReference, resolve as resolveRecipe, saveRecipe } from "./recipes.js";
import { analyzeReference, cachedReference, overridesFrom } from "./reference.js";
import { AssemblySchema, buildAssembly } from "./assembly.js";
import { getJob, projectJobs, startJob, type Job } from "./jobs.js";
import { logEvent, summarizeArgs } from "./events.js";
import { continuePipeline, createProject, listProjects, openProject, status } from "./pipeline.js";
import { Project, readJson } from "./lib/project.js";
import { listStyles } from "./lib/style.js";
import { applyCompose, proposeCompose, setBeats } from "./steps/compose.js";
import { applyCut, fixWords, proposeCut } from "./steps/cut.js";
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
const QUIET = new Set(["studio_status", "studio_list_styles", "studio_list_projects", "studio_doctor", "studio_recipes", "studio_questionnaire"]);

/** The project a tool call is about, for the journal. */
function projectOf(a: unknown): string | undefined {
  const x = (a ?? {}) as Record<string, any>;
  return x.project ?? x.spec?.name ?? x.name ?? (typeof x.source === "string" ? Project.nameFromSource(x.source) : undefined);
}

/**
 * Wrap a handler so errors come back as tool errors the LLM can read, not protocol failures, and so every call lands
 * in the project's journal (what the agent did, with which arguments) for the dashboard.
 */
function safe<A>(tool: string, fn: (a: A) => Promise<{ content: Content[] }>) {
  return async (a: A) => {
    const project = projectOf(a);
    // Polling (studio_status every few seconds) is not a decision: it stays out of the journal.
    if (project && !QUIET.has(tool)) logEvent(project, { kind: "tool", source: "mcp", tool, args: summarizeArgs(a), message: tool });
    try {
      return await fn(a);
    } catch (e) {
      if (project) logEvent(project, { kind: "error", source: "mcp", tool, message: (e as Error).message });
      return { content: [{ type: "text" as const, text: `Erreur : ${(e as Error).message}` }], isError: true };
    }
  };
}

const jobView = (j: Job) => ({ job: j.id, label: j.label, status: j.status, error: j.error, log: j.log.slice(-25), result: j.result });

const ProjectArg = z.string().describe("Project name (from studio_create_project or studio_list_projects)");
const Formats = z.array(z.enum(["16x9", "9x16"])).optional().describe("Output formats, default both");

server.registerTool("studio_list_styles", {
  description: "List the editing styles (styles/*.yaml): fonts, colours, rhythm, animation types.",
}, safe("studio_list_styles", async () => json(listStyles())));

server.registerTool("studio_doctor", {
  description: "Check the local toolchain (Node, FFmpeg, Parakeet, whisper.cpp, matting weights, Chrome, styles) and say how to fix what is missing.",
}, safe("studio_doctor", async () => text(formatChecks(await doctor()))));

server.registerTool("studio_dashboard", {
  description:
    "Start (once) the local dashboard and return its URL: every project's steps, cut plan, motion plan on a timeline " +
    "synced with the render, your tool calls (the journal), QA sheets and versions. Give the URL to the user.",
  inputSchema: { port: z.number().int().optional() },
}, safe("studio_dashboard", async (a) => text(`Tableau de bord : ${await startDashboard(a.port ?? 4600)}`)));

server.registerTool("studio_list_projects", {
  description: "List projects in work/.",
}, safe("studio_list_projects", async () => json(listProjects())));

server.registerTool("studio_create_project", {
  description:
    "Start a project from a face-cam rush: ingest (rotation, CFR, normalization) then word-level transcription " +
    "(Parakeet or whisper.cpp, local). Runs as a background job. Poll studio_status.",
  inputSchema: {
    source: z.string().describe("Path to the rush (mp4/mov/mkv)"),
    style: z.string().optional().describe("Style name (studio_list_styles); not needed with a recipe"),
    recipe: z.string().optional().describe("Recipe name (studio_recipes); sets style, overrides and formats"),
    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional()
      .describe("Questionnaire answers (studio_questionnaire): question id → option label(s); picks and adjusts a recipe"),
    name: z.string().optional().describe("Project name, default derived from the file name"),
    engine: z.enum(["hybrid", "parakeet", "whisper"]).optional().describe(
      "ASR: hybrid (default: whisper's words, Parakeet's word times), parakeet (fast, loses words on noisy audio), whisper",
    ),
    language: z.string().optional().describe("Whisper only: spoken language ISO code, default fr"),
    model: z.string().optional().describe("Whisper only: whisper.cpp model, default large-v3-turbo"),
    like: z.string().optional().describe(
      "A reference video to edit like (see studio_reference): its measured cut rhythm, effects and look go over the style",
    ),
  },
}, safe("studio_create_project", async (a) => {
  const name = a.name ?? Project.nameFromSource(a.source);
  const r = a.recipe || a.answers ? resolveRecipe(a.answers ?? {}, a.recipe) : null;
  const styleName = r?.style ?? a.style;
  if (!styleName) throw new Error("Give a style, a recipe or questionnaire answers");
  const job = startJob(name, "create", async (log) => {
    await createProject(a.source, styleName, {
      name, engine: a.engine ?? r?.recipe.engine, language: a.language, model: a.model, log,
      overrides: r?.overrides, recipe: r?.recipe.name, formats: r?.formats, like: a.like ?? r?.recipe.like,
    });
    const p = await proposeCut(openProject(name).project, openProject(name).style);
    log(`[cut] plan proposé : ${p.plan.sourceDuration}s → ${p.plan.keptDuration}s`);
    return { project: name, next: "studio_cut_review" };
  });
  return json({ project: name, ...jobView(job), brief: r?.prompt, next: "Poll studio_status, then studio_cut_review. Follow the brief." });
}));

server.registerTool("studio_status", {
  description: "Project state: which steps are cached, the cut plan status, and the latest background jobs with their logs.",
  inputSchema: { project: ProjectArg, job: z.string().optional().describe("A job id to inspect") },
}, safe("studio_status", async (a) => {
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
}, safe("studio_cut_review", async (a) => {
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

server.registerTool("studio_fix_words", {
  description:
    "Fix misheard words in a project's transcript once: brand names, URLs, names (e.g. {\"khemrafa.clic\": \"xewxew.click\"}). " +
    "Captions and contextual graphics (URL bar…) then use the right spelling. For an assembly, fix the part project; " +
    "the assembly picks it up when rebuilt.",
  inputSchema: { project: ProjectArg, replace: z.record(z.string(), z.string()).describe("misheard → correct") },
}, safe("studio_fix_words", async (a) => json(fixWords(openProject(a.project).project, a.replace))));

server.registerTool("studio_cut_apply", {
  description: "Approve the cut plan and render cut.mp4 (frame-accurate, 12 ms audio fades). Then run studio_produce.",
  inputSchema: { project: ProjectArg },
}, safe("studio_cut_apply", async (a) => {
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
}, safe("studio_produce", async (a) => {
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
}, safe("studio_beats", async (a) => {
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

server.registerTool("studio_assemble", {
  description:
    "Edit several rushes as ONE video. `spec`: { name, style, parts: [{ project | source, kind?: face|screen, " +
    "reduce?: { mode: bubble|card, broll?: <part project or file>, from?, start?, end? } }], transitions?, " +
    "overrides?: <style overrides>, like?: <reference video to edit like, see studio_reference> }. Example: a face-cam " +
    "intro, then an explanation whose speaker shrinks into a bubble over the screen recording (reduce.broll), then the " +
    "screen recording itself. Background job: prepares each part; while a part's cut plan is unreviewed it stops and " +
    "lists them (review each with studio_cut_review / studio_cut_apply, then call again). Once assembled, continue " +
    "with studio_beats then studio_produce on project = spec.name.",
  inputSchema: { spec: z.any().describe("The assembly spec object (see description)") },
}, safe("studio_assemble", async (a) => {
  const spec = AssemblySchema.parse(a.spec);
  const job = startJob(spec.name, "assemble", (log) => buildAssembly(spec, { log }));
  return json(jobView(job));
}));

server.registerTool("studio_questionnaire", {
  description:
    "The questions that decide what kind of video to make (type, platform, tone, captions, rhythm, footage, extras), " +
    "with their options. Ask them to the user (one screen, multiple choice), then pass the answers to " +
    "studio_create_project { answers } or studio_recipe_preview.",
}, safe("studio_questionnaire", async () => json(loadQuestionnaire())));

server.registerTool("studio_recipes", {
  description: "Saved recipes: a validated way of editing a kind of video (brief, style, overrides, formats, structure).",
}, safe("studio_recipes", async () => json(listRecipes().map((r) => ({ name: r.name, title: r.title, description: r.description, style: r.style, formats: r.formats, structure: r.structure })))));

server.registerTool("studio_recipe_preview", {
  description: "What a recipe and/or questionnaire answers resolve to: style, overrides, formats and the editing brief to follow.",
  inputSchema: {
    recipe: z.string().optional(),
    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  },
}, safe("studio_recipe_preview", async (a) => {
  const r = resolveRecipe(a.answers ?? {}, a.recipe);
  return json({ recipe: r.recipe.name, style: r.style, overrides: r.overrides, formats: r.formats, brief: r.prompt });
}));

server.registerTool("studio_reference", {
  description:
    "Measure a reference video the user wants to edit like (a reel they admire): cuts per second, white flashes, " +
    "strobes, zoom punches, jump-zoom ladders, shakes, whip pans, and its look (brightness, saturation, contrast, " +
    "letterbox). Returns the style overrides that reproduce its energy, the reasons, and one frame per shot. Local " +
    "pixel analysis, no model, no upload. Captions are not measured: look at the frames and pick captions.look " +
    "(bold, pill, editorial, minimal) yourself. Then pass `like` to studio_create_project (or `like` in an assembly " +
    "spec), or `saveRecipe` to keep it as a recipe. The first read runs as a job (poll studio_status with " +
    "project \"_references\" and the job id, then call again).",
  inputSchema: {
    file: z.string().describe("Path to the reference video"),
    saveRecipe: z.object({
      name: z.string().regex(/^[a-z0-9-]+$/), style: z.string().describe("Base style the overrides apply to"),
      title: z.string().optional(), description: z.string().optional(),
    }).optional(),
  },
}, safe("studio_reference", async (a) => {
  const ref = cachedReference(a.file);
  if (!ref) {
    const job = startJob("_references", `reference ${a.file}`, async (log) => {
      await analyzeReference(a.file, log);
      if (a.saveRecipe) await recipeFromReference(a.file, a.saveRecipe.name, a.saveRecipe.style, { ...a.saveRecipe, log });
      return { next: "studio_reference again" };
    });
    return json({ ...jobView(job), next: "Poll studio_status { project: \"_references\", job }, then call studio_reference again." });
  }
  const { overrides, why } = overridesFrom(ref);
  const saved = a.saveRecipe ? await recipeFromReference(a.file, a.saveRecipe.name, a.saveRecipe.style, a.saveRecipe) : null;
  const summary = [...why.map((w) => `- ${w}`), "", JSON.stringify({ per10s: ref.per10s, look: ref.look, events: ref.events, overrides,
    ...(saved ? { recipe: `recipes/${saved.name}.yaml` } : {}) }, null, 2)].join("\n");
  return { content: [...text(summary).content, { type: "image", data: readFileSync(ref.sheet).toString("base64"), mimeType: "image/jpeg" }] };
}));

server.registerTool("studio_recipe_save", {
  description:
    "Save a project the user validated as a reusable recipe (recipes/<name>.yaml): its style and overrides, formats, " +
    "structure, and a brief. Write the brief from what the user liked and asked to change, as instructions for the " +
    "next edit. It then appears in studio_recipes and as an MCP prompt.",
  inputSchema: {
    project: ProjectArg,
    name: z.string().regex(/^[a-z0-9-]+$/).describe("recipe file name, lowercase-dashes"),
    title: z.string().optional(),
    description: z.string().optional(),
    prompt: z.string().optional().describe("The editing brief; a draft is written from the project when omitted"),
  },
}, safe("studio_recipe_save", async (a) => json(saveRecipe(a.project, a.name, { title: a.title, description: a.description, prompt: a.prompt }))));

// Every recipe is also an MCP prompt: a client lists them as selectable commands (Claude Code: /mcp__studio__<name>).
for (const r of listRecipes()) {
  server.registerPrompt(r.name, {
    title: r.title,
    description: `${r.description} (style ${r.style}, ${r.formats.join(" + ")})`,
    argsSchema: {
      rushes: z.string().describe("Rush path(s), comma separated"),
      notes: z.string().optional().describe("Anything specific for this video"),
    },
  }, ({ rushes, notes }) => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          `Monte ${rushes} avec la recette « ${r.title} » de studio (outil studio_create_project avec recipe: "${r.name}"` +
            `${r.structure ? ", ou studio_assemble pour plusieurs rushs" : ""}).`,
          r.structure ? `Structure attendue : ${r.structure}.` : "",
          "",
          r.prompt,
          notes ? `\nPour cette vidéo : ${notes}` : "",
          "",
          "Suis le skill studio : relecture du plan de coupe, relecture des beats, puis QA sur les planches contact.",
        ].filter((l) => l !== undefined).join("\n"),
      },
    }],
  }));
}

server.registerPrompt("questionnaire", {
  title: "Nouvelle vidéo (questionnaire)",
  description: "Pose le questionnaire studio pour choisir le type de montage, puis lance-le.",
  argsSchema: { rushes: z.string().describe("Rush path(s), comma separated") },
}, ({ rushes }) => ({
  messages: [{
    role: "user" as const,
    content: {
      type: "text" as const,
      text: `Je veux monter ${rushes} avec studio. Appelle studio_questionnaire, pose-moi les questions en une fois ` +
        "(choix multiples), montre-moi ce que mes réponses donnent avec studio_recipe_preview, puis lance le montage " +
        "(studio_create_project avec answers, ou studio_assemble pour plusieurs rushs) en suivant le brief.",
    },
  }],
}));

server.registerTool("studio_step", {
  description: "Re-run one late step in the background (compose | audio | render | qa), e.g. after editing beats or a style.",
  inputSchema: { project: ProjectArg, step: z.enum(["compose", "audio", "render", "qa"]), formats: Formats, force: z.boolean().optional() },
}, safe("studio_step", async (a) => {
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
}, safe("studio_qa", async (a) => {
  const { project } = openProject(a.project);
  const r = readJson<Awaited<ReturnType<typeof qa>>>(project.path("qa", "qa.json"));
  const content: Content[] = [{ type: "text", text: JSON.stringify({ files: r.files, warnings: r.warnings }, null, 2) }];
  for (const f of r.files) content.push(image(f.sheet));
  if (a.mattePreview && r.mattePreview) content.push(image(r.mattePreview));
  return { content };
}));

await server.connect(new StdioServerTransport());
