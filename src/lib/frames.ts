import { spawn } from "node:child_process";

/**
 * Stream raw gray frames out of ffmpeg and hand each one to `onFrame` without buffering the whole video.
 * `decoderArgs` go before `-i` (e.g. `-c:v libvpx-vp9`, needed to decode VP9 alpha).
 */
export function streamGrayFrames(
  file: string,
  vf: string,
  width: number,
  height: number,
  onFrame: (frame: Uint8Array, index: number) => void,
  decoderArgs: string[] = [],
): Promise<number> {
  const size = width * height;
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", [
      "-v", "error", ...decoderArgs, "-i", file, "-vf", `${vf},scale=${width}:${height}:flags=area,format=gray`,
      "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]);
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    let err = "";
    p.stdout.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= size) {
        onFrame(new Uint8Array(pending.subarray(0, size)), index++);
        pending = pending.subarray(size);
      }
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(index) : reject(new Error(`ffmpeg frame stream failed: ${err.slice(-600)}`))));
  });
}
