import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Project, WORK_DIR } from "./lib/project.js";

/**
 * A project's journal (work/<project>/events.jsonl): every MCP tool call the driving agent made and every pipeline
 * log line, in order. It is how a person sees what the agent decided and why, in the dashboard.
 */
export interface StudioEvent {
  t: string;
  kind: "tool" | "log" | "error" | "step";
  source: "mcp" | "cli" | "pipeline";
  tool?: string;
  args?: unknown;
  message: string;
}

const journal = (project: string) => join(WORK_DIR, project, "events.jsonl");

export function logEvent(project: string, e: Omit<StudioEvent, "t">): void {
  if (!project) return;
  try {
    mkdirSync(join(WORK_DIR, project), { recursive: true });
    appendFileSync(journal(project), JSON.stringify({ t: new Date().toISOString(), ...e }) + "\n");
  } catch {
    // A journal that cannot be written never fails an edit.
  }
}

export function readEvents(project: string): StudioEvent[] {
  const f = journal(project);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as StudioEvent];
    } catch {
      return [];
    }
  });
}

/** Tool arguments as they go in the journal: long arrays and objects summarized, so beats edits stay readable. */
export function summarizeArgs(args: unknown): unknown {
  if (Array.isArray(args)) return args.length > 6 ? `[${args.length} éléments]` : args.map(summarizeArgs);
  if (args && typeof args === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (k === "beats" && v && typeof v === "object") {
        const b = v as Record<string, unknown[]>;
        out[k] = Object.fromEntries(Object.entries(b).filter(([, x]) => Array.isArray(x)).map(([n, x]) => [n, `${x.length}`]));
      } else out[k] = summarizeArgs(v);
    }
    return out;
  }
  return typeof args === "string" && args.length > 300 ? args.slice(0, 300) + "…" : args;
}

/** A log callback that also writes to the journal. */
export function journaled(project: Project | string, source: "mcp" | "cli", log?: (m: string) => void) {
  const name = typeof project === "string" ? project : project.name;
  return (m: string) => {
    log?.(m);
    logEvent(name, { kind: "log", source, message: m });
  };
}
