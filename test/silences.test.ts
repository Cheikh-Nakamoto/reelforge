import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findSilences } from "../src/lib/ffmpeg.js";

/** Room noise around −38 dB with "speech" bursts ~14 dB louder: the shape of a real phone rush. */
function noisyRush(): string {
  const out = join(mkdtempSync(join(tmpdir(), "studio-sil-")), "rush.wav");
  // Bursts at 0.5–2.5 s and 3.5–5.5 s; the pause 2.5–3.5 s is room noise only.
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.02:d=6:seed=3",
    "-f", "lavfi", "-i", "sine=f=220:d=6",
    "-filter_complex",
    "[1]volume='if(between(t,0.5,2.5)+between(t,3.5,5.5),0.25,0)':eval=frame[s];[0][s]amix=inputs=2:normalize=0",
    "-ar", "16000", "-ac", "1", out,
  ]);
  return out;
}

test("finds the pause in a noisy rush where a fixed -35 dB threshold sees none", async () => {
  const wav = noisyRush();
  const a = await findSilences(wav, 0.2);
  assert.ok(a.speech - a.floor > 8, `levels ${JSON.stringify(a)}`);
  const mid = a.silences.find((s) => s.start < 3 && s.end > 3);
  assert.ok(mid, `pause at 2.5–3.5 s found: ${JSON.stringify(a.silences)}`);
  assert.ok(mid.start > 2.3 && mid.end < 3.7, JSON.stringify(mid));
  const fixed = await findSilences(wav, 0.2, -60);
  assert.equal(fixed.silences.filter((s) => s.start < 3 && s.end > 3).length, 0, "a fixed low threshold misses it");
});
