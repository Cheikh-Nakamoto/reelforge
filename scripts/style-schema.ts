/** Writes styles/style.schema.json from the zod schema, for YAML completion and validation in editors. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { STYLES_DIR, StyleSchema } from "../src/lib/style.js";

const schema = z.toJSONSchema(StyleSchema, { io: "input", target: "draft-7" });
writeFileSync(join(STYLES_DIR, "style.schema.json"), JSON.stringify({ title: "studio style", ...schema }, null, 2) + "\n");
console.log("styles/style.schema.json");
