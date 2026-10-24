# studio — notes for agents working on this codebase

To *use* the pipeline on a video, read `skills/studio/SKILL.md`. This file is for changing the code.

## What it is

A local MCP server and CLI (Node ≥ 22, TypeScript) that edits face-cam rushes: ingest → transcribe → cut →
matte → compose → audio → render → qa. Composition and rendering are HyperFrames (HTML + GSAP rendered by headless
Chrome); FFmpeg does every audio/video operation. Licence: PolyForm Noncommercial 1.0.0 (see `LICENSE`,
`COMMERCIAL.md`).

```
src/
  mcp.ts, cli.ts        two front-ends over the same functions
  pipeline.ts           orchestration: stops at the cut plan until it is approved
  jobs.ts               background jobs for MCP (one running job per project)
  lib/                  exec (child processes, telemetry off), ffmpeg helpers, project/cache, style schema, words
  steps/                one module per step; cutplan.ts, beats.ts, html.ts are pure and unit-tested
styles/*.yaml           styles, validated by StyleSchema (src/lib/style.ts) → styles/style.schema.json
test/                   node:test; html/cutplan/style tests need no media, mcp.test.ts needs `npm run build`
work/<project>/NN-step/ outputs and manifest.json (cache key) of each step — gitignored
```

## Decisions and why

1. **HyperFrames over Remotion** (Phase 0). Apache-2.0 instead of a seat-based licence; ships the local
   transcription, matting (with an inverse plate) and loudness tools we need; compositions are plain HTML we can
   generate from YAML without a build step; `hyperframes check` measures layout, contrast and occlusion.
   Pinned to an exact version (`0.8.188`): the 0.x CLI changes often. Upgrade deliberately and re-run the tests and
   a full render.
2. **No LLM inside.** Every step has a deterministic heuristic default (`cutplan.ts`, `beats.ts`). The client LLM,
   over MCP, reviews `cutplan.md` and `beats.json` and edits them through `propose`/`set` tools. Keep that split:
   a new feature gets a heuristic plus an editable artifact, never a model call.
3. **Parakeet is the default ASR, whisper.cpp the option.** Measured on a fixture with known phrase timings:
   whisper large-v3-turbo word edges drift up to 0.7 s (they stretch over pauses), DTW did not help; Parakeet
   TDT v3 errs by ~0.2 s, in the safe direction (starts early, ends late), and runs 3.5× faster on CPU. Parakeet
   picks its language itself: passing `--language` makes HyperFrames silently fall back to whisper, so
   `transcribe.ts` never passes it and checks the engine HyperFrames reports.
4. **Cuts are bounded by measured silence, not by word times.** `buildSegments` snaps every boundary to a
   `silencedetect` pause near it, and a pause belongs to the gap whose word centres surround it. A kept word is
   re-timed on the segment it overlaps most (not by its midpoint, which ASR stretching moves into removed gaps).
   These were real bugs; the tests in `test/cutplan.test.ts` pin them.
5. **Matte only where it is seen.** U²-Net on this CPU costs ~2.3 s per 1080×1920 frame (~35 min for 30 s). The
   matte step surveys at 1 fps (subject box, head height), then compose mattes only the behind-word windows at full
   rate, scores their stability (alpha oscillation against neighbouring frames, subject lost) and replaces unstable
   candidates. `assembleSubject` builds one full-length transparent `subject.webm` so the cutout mounts at
   `data-start=0` with the footage (HyperFrames: a late-mounted cutout lands a frame off).
6. **Two camera stacks.** Footage (`#cam`, z 1), behind-words (z 2), cutout (`#cutcam`, z 3). The cutout must not
   sit inside the footage's element: that element's z-index makes a stacking context and the word would paint over
   the face (it did, in the first render). Camera moves target the `.cam` / `.push` classes so both stacks move
   identically. Test: `test/html.test.ts`.
7. **Behind-words are placed on the real matte.** `placement.ts` samples the cutout's alpha three times per word
   and picks the size and height where the subject hides ~40 % of the letters (style `behind.coverage`), above
   the captions. Estimating from the head box alone put words 75 % behind the head. Unreadable placements become
   QA warnings.
8. **Looks are baked by FFmpeg, not graded in the browser.** HyperFrames' `data-color-grading` runs per frame and
   per video layer in Chrome: without a GPU the same 17 s vertical render took 962 s instead of 180 s. `look.ts`
   applies one filter chain to the footage, the cutout (alpha kept) and the blurred plate; FFmpeg's fixed noise
   seed keeps the grain identical across layers.
9. **Sound is mixed outside HyperFrames.** The composition is silent; `audio.ts` builds the mix (denoise,
   compression, two-pass loudnorm to −16 LUFS, sidechain ducking, synthesised SFX) and `render.ts` muxes it.
   This keeps loudness exact and measurable (`ebur128`).
10. **Provenance.** Exports carry a `comment` metadata tag naming studio and its licence, and `07-render/receipt.json`
   records versions, models, style hash and per-step parameters. Do not remove these; they are how the
   noncommercial licence stays visible downstream.
11. **Nothing leaves the machine.** `lib/exec.ts` sets `HYPERFRAMES_NO_TELEMETRY`, `DO_NOT_TRACK` and
   `HYPERFRAMES_SKIP_SKILLS` on every child process. Models download once into `~/.cache/hyperframes/`.

## HyperFrames contract (the parts that bit us)

- One paused GSAP timeline registered as `window.__timelines["main"]`; no `Date.now()`, no unseeded random.
- Timed elements carry `class="clip"`, `data-start`, `data-duration`; never tween `visibility` on them.
- Do not repeat `fromTo` on one target (its `from` leaks into earlier seeks): `set` a baseline, then `to`.
- Fonts by name only if bundled (Inter, Montserrat, Oswald, League Gothic, Archivo Black, Playfair Display,
  JetBrains Mono, Poppins…); others need `@font-face` with a local file.
- No `data-color-grading` (see decision 8). GSAP is copied from `node_modules` into each project (`assets/gsap.min.js`); never load it from a CDN.
- `hyperframes check --json` prints one indented JSON report with sections `lint`, `runtime`, `layout`, `motion`,
  `contrast`, `craft`; `film_silent` is expected (sound is muxed later).

## Working rules

- `npm run typecheck && npm test` before calling anything done; render a short fixture
  (`scripts/make-fixture.sh`) after touching `html.ts`, `matte.ts`, `audio.ts` or `render.ts`, and **look** at the
  contact sheet and at a full-resolution frame of a behind-word (crop the head).
- Cache keys: cut, compose, audio and render hash their own source (`codeOf`), so editing them re-runs them. The
  model steps (ingest, transcribe, matte) do not, on purpose (tens of minutes): bump their `version` by hand when
  their output changes. Matte windows are keyed on the cut video they came from.
- Code comments explain why, not what. Keep functions in `cutplan.ts`, `beats.ts` and `html.ts` pure.
- Every new dependency or model: check its licence fits noncommercial redistribution and add it to
  `THIRD_PARTY.md`. No GPL code linked in-process; no CC BY-NC weights.
- Never commit or push unless the maintainer asks.
