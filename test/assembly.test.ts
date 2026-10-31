import assert from "node:assert/strict";
import { test } from "node:test";
import { AssemblySchema } from "../src/assembly.js";

test("assembly junctions ride one direction by default", () => {
  const spec = AssemblySchema.parse({ name: "short", style: "cinematic", parts: [{ project: "a" }, { project: "b" }] });
  assert.deepEqual(spec.transitions, ["smoothleft"]);
});

test("assembly refuses crossfade transitions and proposes smoothleft", () => {
  for (const t of ["fade", "fadeblack", "fadewhite", "fadegrays", "fadefast", "fadeslow", "dissolve"]) {
    const r = AssemblySchema.safeParse({ name: "s", style: "cinematic", parts: [{ project: "a" }], transitions: [t] });
    assert.equal(r.success, false, t);
    assert.match(JSON.stringify(r.error?.issues), /smoothleft/);
  }
  const ok = AssemblySchema.safeParse({ name: "s", style: "cinematic", parts: [{ project: "a" }], transitions: ["cut", "zoomin"] });
  assert.equal(ok.success, true);
});
