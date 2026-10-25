import { randomUUID } from "node:crypto";
import { logEvent } from "./events.js";

export interface Job {
  id: string;
  project: string;
  label: string;
  status: "running" | "done" | "error";
  log: string[];
  result?: unknown;
  error?: string;
  startedAt: string;
  endedAt?: string;
}

const jobs = new Map<string, Job>();

/**
 * Long steps (matte, render) outlive an MCP call's timeout: they run here and the client polls `studio_status`.
 * One running job per project, since steps share the project's files.
 */
export function startJob(project: string, label: string, fn: (log: (m: string) => void) => Promise<unknown>): Job {
  const running = [...jobs.values()].find((j) => j.project === project && j.status === "running");
  if (running) throw new Error(`Project "${project}" is busy with job ${running.id} (${running.label}). Poll studio_status.`);
  const job: Job = { id: randomUUID().slice(0, 8), project, label, status: "running", log: [], startedAt: new Date().toISOString() };
  jobs.set(job.id, job);
  const log = (m: string) => {
    job.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
    if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
    logEvent(project, { kind: "log", source: "mcp", message: m });
  };
  fn(log)
    .then((result) => {
      Object.assign(job, { status: "done", result, endedAt: new Date().toISOString() });
      logEvent(project, { kind: "log", source: "mcp", message: `[job] ${label} terminé` });
    })
    .catch((e: Error) => {
      Object.assign(job, { status: "error", error: e.message, endedAt: new Date().toISOString() });
      logEvent(project, { kind: "error", source: "mcp", message: `[job] ${label} : ${e.message}` });
    });
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function projectJobs(project: string): Job[] {
  return [...jobs.values()].filter((j) => j.project === project);
}

export function allJobs(): Job[] {
  return [...jobs.values()];
}
