// Journal helper: node log.mjs "<message>" [step|log|tool]
import { logEvent } from "../../dist/events.js";
const [message, kind = "log"] = process.argv.slice(2);
logEvent("video-intro-funk-v2", { kind, source: "cli", message });
