import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../src/lib/exec.js";
import { kindLevels, measureSfx, parseWindows, shapeOf } from "../src/lib/sfx.js";

test("attack and peak come from 10 ms windows", () => {
  // 30 ms of silence, a swell, the loudest window at 80 ms, a tail.
  const rms = [-120, -120, -120, -45, -30, -18, -10, -6, -4, -9, -20, -40];
  assert.deepEqual(shapeOf(rms), { onset: 0.05, peak: 0.08, level: -4 });
  assert.deepEqual(parseWindows("lavfi.astats.Overall.RMS_level=-inf\nlavfi.astats.Overall.RMS_level=-12.5\n"), [-120, -12.5]);
});

test("a kind plays at its median level", () => {
  const info = (level: number) => ({ onset: 0, peak: 0, level, duration: 1, stamp: "" });
  assert.deepEqual(kindLevels({ "hit/a.wav": info(-10), "hit/b.wav": info(-20), "hit/c.wav": info(-14), "pop/a.wav": info(-8) }),
    { hit: -14, pop: -8 });
});

test("a sound with a silent head is measured from its attack", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "sfx-")), "late.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
    "aevalsrc='if(gte(t,0.2),0.8*sin(2*PI*600*t)*exp(-(t-0.2)*12),0)':d=0.6", f]);
  const m = await measureSfx(f);
  assert.ok(Math.abs(m.onset - 0.2) <= 0.011, `onset ${m.onset}`);
  assert.ok(m.peak >= 0.2 && m.peak <= 0.23, `peak ${m.peak}`);
  assert.ok(m.level > -6 && m.level < 0, `level ${m.level}`);
});
