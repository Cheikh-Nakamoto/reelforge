import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { readEvents } from "./events.js";
import { allJobs } from "./jobs.js";
import { Project, readJson, STEPS, WORK_DIR } from "./lib/project.js";
const UI = join(ROOT, "templates", "dashboard.html");
import { listProjects, status } from "./pipeline.js";
import { ROOT } from "./lib/project.js";

/**
 * Local dashboard: what the pipeline and the driving agent did for each project, step by step — cut plan, motion plan
 * on a timeline synced with the render, QA sheets, the agent's tool calls, versions. Read-only, bound to 127.0.0.1.
 */

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json",
  ".md": "text/markdown; charset=utf-8", ".wav": "audio/wav", ".html": "text/html; charset=utf-8",
};

const opt = <T>(file: string): T | null => {
  try {
    return existsSync(file) ? readJson<T>(file) : null;
  } catch {
    return null;
  }
};

/** Everything a project produced, in one object for the page. */
export function projectReport(name: string) {
  const p = new Project(name);
  if (!p.exists()) throw new Error(`Unknown project ${name}`);
  const step = (s: (typeof STEPS)[number], f: string) => join(p.dir, `${String(STEPS.indexOf(s) + 1).padStart(2, "0")}-${s}`, f);
  const renders = (["16x9", "9x16"] as const)
    .map((f) => ({ format: f, file: `07-render/${name}_${f}.mp4` }))
    .filter((r) => existsSync(join(p.dir, r.file)))
    .map((r) => ({ ...r, mtime: statSync(join(p.dir, r.file)).mtimeMs }));
  const sheets = ["16x9", "9x16"].map((f) => `08-qa/sheet_${f}.png`).filter((f) => existsSync(join(p.dir, f)));
  return {
    name,
    status: status(p),
    probe: opt(step("ingest", "probe.json")),
    transcript: { alignment: opt(step("transcribe", "alignment.json")), words: (opt<unknown[]>(step("transcribe", "words.json")) ?? []).length },
    cutplan: opt(step("cut", "cutplan.json")),
    assembly: opt(step("cut", "assembly.json")),
    matte: opt(step("matte", "matte.json")),
    beats: opt(step("compose", "beats.json")),
    compose: opt(step("compose", "compose.json")),
    audio: opt(step("audio", "audio.json")),
    receipt: opt(step("render", "receipt.json")),
    qa: opt(step("qa", "qa.json")),
    renders,
    sheets,
    mattePreview: existsSync(step("matte", "matte-preview.png")) ? "04-matte/matte-preview.png" : null,
    events: history(p),
    jobs: allJobs().filter((j) => j.project === name),
  };
}

/**
 * The journal plus each step's completion from its manifest (finish time, duration, parameters), so a project made
 * before the journal existed still shows its history.
 */
function history(p: Project) {
  const steps = STEPS.flatMap((s) => {
    const m = opt<{ key?: string; finishedAt?: string; seconds?: number; params?: unknown }>(
      join(p.dir, `${String(STEPS.indexOf(s) + 1).padStart(2, "0")}-${s}`, "manifest.json"));
    return m?.key && m.finishedAt
      ? [{ t: m.finishedAt, kind: "step" as const, source: "pipeline" as const, message: `étape ${s} terminée (${m.seconds} s)`, args: m.params }]
      : [];
  });
  return [...readEvents(p.name), ...steps].sort((a, b) => a.t.localeCompare(b.t));
}

function send(res: import("node:http").ServerResponse, code: number, body: string | Buffer, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

/** A file under work/<project>/, with HTTP range support so the video player can seek. */
function serveFile(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, project: string, rel: string) {
  const root = join(WORK_DIR, project) + sep;
  const file = normalize(join(root, rel));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, "not found", "text/plain");
  const size = statSync(file).size;
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
  createReadStream(file).pipe(res);
}

let running: { server: Server; url: string } | null = null;

export function stopDashboard(): Promise<void> {
  const r = running;
  running = null;
  return new Promise((resolve) => (r ? r.server.close(() => resolve()) : resolve()));
}

export function startDashboard(port = 4600): Promise<string> {
  if (running) return Promise.resolve(running.url);
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (!parts.length) return send(res, 200, readFileSync(UI, "utf8"), "text/html; charset=utf-8");
      if (parts[0] === "api" && parts[1] === "projects" && parts.length === 2) {
        const list = listProjects().map((n) => {
          const p = new Project(n);
          const m = p.meta;
          const last = statSync(join(p.dir, "project.json")).mtimeMs;
          return { name: n, style: m.style, recipe: m.recipe, assembly: !!m.assembly, source: m.source, updated: last };
        }).sort((a, b) => b.updated - a.updated);
        return send(res, 200, JSON.stringify(list));
      }
      if (parts[0] === "api" && parts[1] === "projects" && parts[2]) return send(res, 200, JSON.stringify(projectReport(parts[2])));
      if (parts[0] === "files" && parts[1]) return serveFile(req, res, parts[1], parts.slice(2).join("/"));
      return send(res, 404, "not found", "text/plain");
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: (e as Error).message }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      running = { server, url: `http://127.0.0.1:${port}/` };
      resolve(running.url);
    });
  });
}
