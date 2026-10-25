import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Called with each stderr chunk, for progress reporting. */
  onStderr?: (chunk: string) => void;
  /** Resolve instead of throwing on a non-zero exit. */
  allowFail?: boolean;
}

/** Environment every child process gets: HyperFrames telemetry and skill checks off, so nothing leaves the machine. */
export const LOCAL_ENV = {
  HYPERFRAMES_NO_TELEMETRY: "1",
  DO_NOT_TRACK: "1",
  HYPERFRAMES_SKIP_SKILLS: "1",
};

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...LOCAL_ENV, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const res = { code: code ?? -1, stdout, stderr };
      if (code !== 0 && !opts.allowFail) {
        const tail = stderr.trim().split("\n").slice(-15).join("\n");
        reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}\n${tail}`));
      } else resolve(res);
    });
  });
}

/** Like `run`, for a command whose stdout is binary (raw frames, PCM): resolves with the bytes. */
export function runBuffer(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...LOCAL_ENV }, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}\n${stderr.trim().split("\n").slice(-10).join("\n")}`));
    });
  });
}

/** Path of the pinned HyperFrames CLI installed in this repo. */
export function hyperframesBin(): string {
  return new URL("../../node_modules/.bin/hyperframes", import.meta.url).pathname;
}

export function hyperframes(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return run(hyperframesBin(), args, opts);
}
