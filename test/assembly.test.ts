import assert from "node:assert/strict";
import { test } from "node:test";
import { AssemblySchema } from "../src/assembly.js";

test("assembly junctions ride one direction by default", () => {
  const spec = AssemblySchema.parse({ name: "short", style: "cinematic", parts: [{ project: "a" }, { project: "b" }] });
  assert.deepEqual(spec.transitions, ["smoothleft"]);
});
