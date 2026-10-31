import { test } from "node:test";
import assert from "node:assert/strict";
import { gpuMode, parseEncoders, parseLspci, parseNvidiaSmi, planGpu, usableApis, type Gpu } from "../src/lib/gpu.js";

const FF = " V....D h264_nvenc NVIDIA NVENC\n V....D h264_vaapi H.264/AVC (VAAPI)\n V....D h264_qsv H.264 (Intel Quick Sync)\n V....D libx264 x264";

test("no display controller: no GPU", () => {
  assert.equal(parseLspci("00:00.0 Host bridge: Intel Corporation Xeon\n00:14.0 USB controller: Intel"), null);
  assert.equal(parseNvidiaSmi(""), null);
});

test("NVIDIA: nvidia-smi gives name and memory, CUDA and NVENC usable", () => {
  const n = parseNvidiaSmi("NVIDIA GeForce RTX 3060, 12288\n");
  assert.deepEqual(n, { name: "NVIDIA GeForce RTX 3060", memoryMb: 12288 });
  assert.deepEqual(usableApis("nvidia", parseEncoders(FF), true, true), ["cuda", "nvenc"]);
  assert.deepEqual(usableApis("nvidia", parseEncoders(FF), false, true), []);
});

test("AMD and Intel: VAAPI needs a render node; no CUDA", () => {
  const amd = parseLspci("03:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi 23");
  assert.equal(amd?.vendor, "amd");
  assert.deepEqual(usableApis("amd", parseEncoders(FF), false, true), ["vaapi"]);
  const intel = parseLspci("00:02.0 VGA compatible controller: Intel Corporation HD Graphics 620 (rev 02)");
  assert.equal(intel?.vendor, "intel");
  assert.deepEqual(usableApis("intel", parseEncoders(FF), false, true), ["vaapi", "qsv"]);
  assert.deepEqual(usableApis("intel", parseEncoders(FF), false, false), []);
});

test("plan: no GPU in auto is the historical command line", () => {
  assert.deepEqual(planGpu(null, "auto"), { matte: { device: "auto", env: {} }, render: [], renderHardware: false });
});

test("plan: NVIDIA uses CUDA for the matte and hardware encoding; off cuts everything", () => {
  const g: Gpu = { vendor: "nvidia", name: "RTX", memoryMb: 8000, apis: ["cuda", "nvenc"] };
  const p = planGpu(g, "auto");
  assert.equal(p.matte.device, "cuda");
  assert.equal(p.matte.env.HYPERFRAMES_CUDA, "1");
  assert.deepEqual(p.render, ["--gpu"]);
  assert.equal(p.renderHardware, true);
  const off = planGpu(g, "off");
  assert.equal(off.matte.device, "cpu");
  assert.equal(off.renderHardware, false);
  assert.deepEqual(planGpu(g, "on").render, ["--gpu", "--browser-gpu"]);
});

test("plan: an Intel iGPU without CUDA keeps the CPU matte", () => {
  assert.equal(planGpu({ vendor: "intel", name: "HD", apis: ["vaapi"] }, "auto").matte.device, "auto");
});

test("STUDIO_GPU parsing", () => {
  assert.equal(gpuMode({}), "auto");
  assert.equal(gpuMode({ STUDIO_GPU: "off" }), "off");
  assert.equal(gpuMode({ STUDIO_GPU: "1" }), "on");
});
