# Changelog

## 0.1.0 — unreleased

First version.

- Pipeline ingest → transcribe → cut → matte → compose → audio → render → qa, cached per step in `work/`.
- MCP server (`dist/mcp.js`) with review gates for the cut plan and the motion plan, background jobs, and QA
  contact sheets returned as images; CLI (`dist/cli.js`) over the same functions.
- Parakeet TDT v3 as default ASR, whisper.cpp large-v3-turbo as option; cut points snapped to measured silences.
- Behind-the-subject words with per-window matting and flicker rejection; captions, counters, callouts,
  underlines, badges, list steps; jump-cut framing, punch-in, grade, grain, vignette, letterbox.
- Audio: denoise, compression, two-pass loudnorm to −16 LUFS, ducked music bed, synthesised SFX.
- Styles `cinematic`, `tech-explainer`, `reel-dynamique` with a JSON schema.
- PolyForm Noncommercial 1.0.0 licence, commercial licensing through the author, provenance tag and render receipt.
