import { existsSync, readdirSync } from "node:fs";
import { run } from "./exec.js";

export type GpuVendor = "nvidia" | "amd" | "intel";
/** Hardware video encoders FFmpeg can drive; `cuda` is the ONNX execution provider the matte can use. */
export type GpuApi = "cuda" | "nvenc" | "vaapi" | "qsv" | "amf";

export interface Gpu {
  vendor: GpuVendor;
  name: string;
  memoryMb?: number;
  apis: GpuApi[];
}

/** `auto` uses a GPU when one is usable, `off` forces the CPU path, `on` also forces Chrome's hardware GL. */
export type GpuMode = "auto" | "off" | "on";

export function gpuMode(env: NodeJS.ProcessEnv = process.env): GpuMode {
  const v = (env.STUDIO_GPU ?? "auto").toLowerCase();
  if (["off", "0", "false", "cpu"].includes(v)) return "off";
  if (["on", "1", "true", "force"].includes(v)) return "on";
  return "auto";
}

/** `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` → first board. */
export function parseNvidiaSmi(out: string): { name: string; memoryMb?: number } | null {
  const line = out.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const [name, mem] = line.split(",").map((s) => s.trim());
  if (!name || /failed|couldn't|no devices/i.test(line)) return null;
  const memoryMb = Number(mem);
  return { name, memoryMb: Number.isFinite(memoryMb) && mem ? memoryMb : undefined };
}

/** `lspci` lines of display controllers → vendor and marketing name of the first one with a known vendor. */
export function parseLspci(out: string): { vendor: GpuVendor; name: string } | null {
  for (const line of out.split("\n")) {
    if (!/(VGA compatible controller|3D controller|Display controller)/i.test(line)) continue;
    const name = line.replace(/^.*?(VGA compatible controller|3D controller|Display controller)\s*:\s*/i, "").trim();
    if (/nvidia/i.test(line)) return { vendor: "nvidia", name };
    if (/\b(amd|ati|advanced micro devices)\b/i.test(line)) return { vendor: "amd", name };
    if (/intel/i.test(line)) return { vendor: "intel", name };
  }
  return null;
}

/** Names of the hardware H.264 encoders in `ffmpeg -encoders`. */
export function parseEncoders(out: string): GpuApi[] {
  const apis: GpuApi[] = [];
  if (/\bh264_nvenc\b/.test(out)) apis.push("nvenc");
  if (/\bh264_vaapi\b/.test(out)) apis.push("vaapi");
  if (/\bh264_qsv\b/.test(out)) apis.push("qsv");
  if (/\bh264_amf\b/.test(out)) apis.push("amf");
  return apis;
}

/**
 * Which APIs a board can really use: an encoder compiled into FFmpeg is not enough, the vendor and (for VAAPI/QSV)
 * a DRM render node must be there too. CUDA needs NVIDIA's own tool to answer.
 */
export function usableApis(vendor: GpuVendor, encoders: GpuApi[], nvidiaSmiOk: boolean, renderNode: boolean): GpuApi[] {
  const apis: GpuApi[] = [];
  if (vendor === "nvidia") {
    if (nvidiaSmiOk) apis.push("cuda");
    if (nvidiaSmiOk && encoders.includes("nvenc")) apis.push("nvenc");
  }
  if (vendor === "amd" && renderNode) {
    if (encoders.includes("vaapi")) apis.push("vaapi");
    if (encoders.includes("amf")) apis.push("amf");
  }
  if (vendor === "intel" && renderNode) {
    if (encoders.includes("vaapi")) apis.push("vaapi");
    if (encoders.includes("qsv")) apis.push("qsv");
  }
  return apis;
}

let cache: Promise<Gpu | null> | undefined;

/** Local probe only (decision 17): nvidia-smi, lspci, /dev/dri, ffmpeg -encoders. No GPU → null. */
export function detectGpu(): Promise<Gpu | null> {
  cache ??= probe().catch(() => null);
  return cache;
}

async function probe(): Promise<Gpu | null> {
  const smi = await run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { allowFail: true }).catch(() => null);
  const nv = smi && smi.code === 0 ? parseNvidiaSmi(smi.stdout) : null;
  const pci = parseLspci((await run("lspci", [], { allowFail: true }).catch(() => null))?.stdout ?? "");
  const vendor: GpuVendor | null = nv ? "nvidia" : (pci?.vendor ?? null);
  if (!vendor) return null;
  const enc = parseEncoders((await run("ffmpeg", ["-hide_banner", "-encoders"], { allowFail: true }).catch(() => null))?.stdout ?? "");
  const renderNode = existsSync("/dev/dri") && readdirSync("/dev/dri").some((f) => f.startsWith("renderD"));
  return {
    vendor,
    name: nv?.name ?? pci?.name ?? vendor,
    memoryMb: nv?.memoryMb,
    apis: usableApis(vendor, enc, !!nv, renderNode),
  };
}

export interface GpuPlan {
  /** HyperFrames `remove-background --device` and the env it needs (CUDA is opt-in there). */
  matte: { device: "auto" | "cpu" | "cuda"; env: Record<string, string> };
  /** Extra `hyperframes render` flags. Empty = today's CPU behaviour. */
  render: string[];
  /** True when the render's pixels or bitstream may differ from the CPU path (goes into the picture cache key). */
  renderHardware: boolean;
}

/** Pure: what each step does for this board and mode. No GPU in `auto` is exactly the historical command line. */
export function planGpu(gpu: Gpu | null, mode: GpuMode): GpuPlan {
  if (mode === "off") return { matte: { device: "cpu", env: {} }, render: ["--no-browser-gpu"], renderHardware: false };
  const cuda = !!gpu?.apis.includes("cuda");
  const encode = !!gpu && gpu.apis.some((a) => a !== "cuda");
  const render = [...(encode ? ["--gpu"] : []), ...(mode === "on" ? ["--browser-gpu"] : [])];
  return {
    matte: cuda ? { device: "cuda", env: { HYPERFRAMES_CUDA: "1" } } : { device: "auto", env: {} },
    render,
    renderHardware: render.length > 0,
  };
}

export function describeGpu(gpu: Gpu | null, mode: GpuMode): string {
  if (!gpu) return `no GPU found (STUDIO_GPU=${mode}): CPU path`;
  const mem = gpu.memoryMb ? `, ${gpu.memoryMb} MB` : "";
  const apis = gpu.apis.length ? gpu.apis.join("+") : "no usable API";
  return `${gpu.vendor} ${gpu.name}${mem}; ${apis} (STUDIO_GPU=${mode})`;
}
