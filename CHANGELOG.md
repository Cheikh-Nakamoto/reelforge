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
- Dashboard (`studio serve`, `studio_dashboard`): steps, render with synced timeline, cut plan, motion plan, the
  journal of the agent's tool calls (`events.jsonl`), QA and versions.
- Kinetic typography scenes, slam captions, 3D phone for screen recordings, take drift, xfade transitions between
  assembled parts, After Effects-style motion blur (vendored HyperFrames snippet, Apache-2.0).
- Recipes (`recipes/*.yaml`, saved from a validated montage with `studio_recipe_save`) and a questionnaire that
  picks and adjusts one; every recipe is an MCP prompt. Per-project style overrides.
- Contextual graphics (hook, URL bar, question, A-vs-B, definition, CTA), kinetic captions with key words and
  emojis, CSS 3D entrances and extruded type (`motion.depth`), `studio fix` / `studio_fix_words` for misheard names.
- CC0 sound-effects library (`scripts/fetch-sfx.sh`: Kenney, OpenGameArt) used in rotation; keystroke clicks.
- Assemblies (`studio assemble`, `studio_assemble`): several rushes joined into one video, each with its reviewed cut;
  frame reductions to a card (room for graphics) or a corner bubble over B-roll.
- Hybrid transcription (whisper text + Parakeet timings) and adaptive silence detection, after the first real rushes.
- Effects: zoom punch, camera shake, white flash, whip pan, light leaks and colour pop, chosen from strong words,
  keywords and cuts under a per-style density budget, with matching sound cues.
- Captions rebuilt on what top short-form edits do: 2–3 words a group (character limit, commas, no trailing article),
  heavy type with outline and hard shadow instead of a box, looks `bold` / `pill` / `editorial` / `minimal`, the key
  word on its own line and rationed (one every 1.2 s), emoji stickers, hard cuts between groups.
- Reference videos (`studio reference`, `studio_reference`, `--like`, `like` in assemblies and recipes): cuts,
  flashes, strobes, punches, zoom ladders, shakes, whips and look measured locally and turned into overrides; an
  energy check in the QA compares the render with the reference.
- New effects: strobe, zoom ladder, and an RGB split and slice glitch baked by FFmpeg inside their windows; a
  `glitch` sound category (Kenney Sci-Fi Sounds, CC0); one-layer overlap rule and a budget checked around every
  effect.
- SFX placed on their measured attack (a whoosh on its peak) and levelled per kind; `--workers` /
  `STUDIO_RENDER_WORKERS` for render machines with more cores.
- `films/`: hand-made music-only films; `video-intro-funk-v2` (XewXew intro) with its setup, storyboard, seam ledger
  checked by `seam-gate.mjs`, render and review.
- PolyForm Noncommercial 1.0.0 licence, commercial licensing through the author, provenance tag and render receipt.
