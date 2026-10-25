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
films/<name>/           hand-made films with no rush (music only): setup, storyboard, ledger, render; README per film
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
3. **Hybrid ASR: whisper's words, Parakeet's times.** On the synthetic fixture Parakeet looked best (edges within
   ~0.2 s, whisper up to 0.7 s off). On the first real, noisy phone rush it kept 38 of 76 words and switched to
   English mid-sentence, while whisper large-v3-turbo had every word. `lib/align.ts` aligns the two transcripts (LCS
   on normalized words): matched words take Parakeet's times, the rest are spread between anchors. Parakeet picks its
   language itself: passing `--language` makes HyperFrames silently run whisper, so it is never passed for it.
   Lesson: validate on real footage; the synthetic fixture was far too clean (noise floor −74 dB vs −32 to −42 dB).
4. **Cuts are bounded by measured silence, not by word times.** Silence is found against the rush's own noise floor
   (`findSilences`: a third of the way from the 10th to the 90th percentile of 50 ms RMS windows); a fixed −35 dB
   found no pause at all on real rushes. `buildSegments` snaps every boundary to a pause near it, and a pause belongs to the gap whose word centres surround it. A kept word is
   re-timed on the segment it overlaps most (not by its midpoint, which ASR stretching moves into removed gaps).
   These were real bugs; the tests in `test/cutplan.test.ts` pin them.
5. **Matte only where it is seen.** U²-Net on this CPU costs ~2.3 s per 1080×1920 frame (~35 min for 30 s). The
   matte step surveys at 1 fps (subject box, head height), then compose mattes only the behind-word windows at full
   rate, scores their stability (alpha oscillation against neighbouring frames, subject lost) and replaces unstable
   candidates. `assembleSubject` builds one full-length transparent `subject.webm` so the cutout mounts at
   `data-start=0` with the footage (HyperFrames: a late-mounted cutout lands a frame off).
6. **Two camera stacks.** Footage (`#frame-cam` > `#cam`, z 1), behind-words (z 2), cutout (`#frame-cut` > `#cutcam`,
   z 3); each stack is `.frame > .cam > .push > .shake`, every level moved on both stacks at once. The cutout must not
   sit inside the footage's element: that element's z-index makes a stacking context and the word would paint over
   the face (it did, in the first render). Camera moves target the `.cam` / `.push` classes so both stacks move
   identically. Test: `test/html.test.ts`.
7. **Behind-words are placed on the real matte.** `placement.ts` samples the cutout's alpha three times per word
   and picks the size and height where the subject hides ~40 % of the letters (style `behind.coverage`), above
   the captions. Estimating from the head box alone put words 75 % behind the head. Unreadable placements become
   QA warnings.
8. **Looks are baked by FFmpeg, identically on every layer.** `look.ts` applies one filter chain to the footage, the
   cutout (alpha kept) and the blurred plate; FFmpeg's fixed noise seed keeps the grain identical across layers.
   HyperFrames' current contract also routes footage grades, grain and blur through `media-treatment`, never CSS
   filters. Browser grading (`data-color-grading`, 962 s instead of 180 s for 17 s) was rejected for its cost, which
   decision 21 now accepts; the shared chain is what keeps it out.
9. **Assemblies and frame reductions.** Several rushes become one video through `assembly.ts`: each part keeps its own
   reviewed cut, parts are fitted to one canvas over a blurred copy and joined, and the joined project's `03-cut/`
   (video, words, synthetic cut plan, `assembly.json` layout) feeds the usual steps. A third `.frame` level wraps both
   camera stacks and shrinks them into a card (room for graphics) or a corner bubble over B-roll. Screen-recording
   parts and reduced windows get no behind-words.
10. **Motion design: contextual, kinetic, CSS 3D.** `contextual.ts` turns phrasing into graphics the way AI editors
   pick visuals (question card, typed URL bar, A-vs-B, definition, CTA, opening hook), and marks one key word per
   caption group (bigger, accent colour, bounce) plus rationed emojis. "3D" is CSS perspective (rotationX/Y tip-ins)
   and extruded type from stacked text-shadows; a real WebGL scene is allowed too, rendered in software (decision 21). Rules learned on
   real speech: no hook from a greeting, no card for a tag question ("…, vous voyez ?"), no callout on a negated
   keyword ("pas de problème"), no repeated emoji.
11. **"Badass" motion on a CPU: spend time, not GPU.** Kinetic typography scenes (`stage.ts`: punchline clauses land as
   full-screen type in a blurred inverse zoom-through, each word slamming in on its spoken time, landing shake), screen recordings in a CSS 3D phone,
   a slow push on every take (`.drift`, fourth camera level), Hormozi-style slam captions, FFmpeg xfade transitions
   between assembled parts, and After Effects-style motion blur (HyperFrames' Apache-2.0 snippet, vendored in
   `templates/vendor/`). Registry components were tried first: they are authored for 16:9 and render tiny in 9:16,
   so studio builds its own at the right scale and reuses the snippet that ports cleanly.
12. **Observable by design.** Every MCP tool call (except polling) and every pipeline log line is appended to
   `work/<project>/events.jsonl`; `dashboard.ts` serves it with the step manifests and every artifact on 127.0.0.1
   (no dependency, path-checked, HTTP ranges for video). The page is a static file, `templates/dashboard.html`.
13. **Recipes over prompts in code.** A validated montage becomes `recipes/<name>.yaml` (brief + style + overrides +
   formats + structure); the questionnaire maps answers to a recipe and overrides. Overrides are stored per project
   (`project.json`) and merged over the style before validation (`loadStyle(name, overrides)`), so shared style
   files never change for one video. Recipes are registered as MCP prompts at server start.
14. **Effects keep the cutout registered.** Shake, zoom punch and whip move a `.shake` level present in both camera
   stacks; pixel effects on the footage are baked by FFmpeg (the colour pop's black-and-white copy under the cutout;
   RGB split and glitch, decision 20); flash and light leaks are overlay divs. Layers with no cutout twin (graphics,
   type, stage scenes) may use CSS filters such as blur, blend modes and shaders (decision 21). `effects.ts` picks
   effects under a density budget.
15. **Sound is mixed outside HyperFrames.** The composition is silent; `audio.ts` builds the mix (denoise,
   compression, two-pass loudnorm to −16 LUFS, sidechain ducking, synthesised SFX) and `render.ts` muxes it.
   This keeps loudness exact and measurable (`ebur128`).
16. **Provenance.** Exports carry a `comment` metadata tag naming studio and its licence, and `07-render/receipt.json`
   records versions, models, style hash and per-step parameters. Do not remove these; they are how the
   noncommercial licence stays visible downstream.
17. **Nothing leaves the machine.** `lib/exec.ts` sets `HYPERFRAMES_NO_TELEMETRY`, `DO_NOT_TRACK` and
   `HYPERFRAMES_SKIP_SKILLS` on every child process. Models download once into `~/.cache/hyperframes/`.
18. **Captions follow the short-form canon, not TV subtitles.** 2–3 words, one line, 80–100 px at 1080, heavy type
   with a `paint-order` outline (no box), one accent colour, a hard cut between groups (`steps/captions.ts`). Every
   word of a `pop` group is visible from its start: a key word that waited for its time left a hole in the line.
   Key words are rationed (one per 1.2 s): one in every group read as flashing.
19. **References are measured, not imitated by a model** (`reference.ts`, the local take on Higgsfield Katana's
   frame-by-frame read). 96-px grey frames from FFmpeg, a brute-force global motion search (translation, then
   scale), and rules: flash = brightness jump that returns; cut = error no move explains (hard), or a one-frame
   peak 2–5× the local level that still holds 4 frames on (a jump cut on a face: 9–17 against 2–7 on real rushes);
   jump zoom = sudden difference a ≥ 4 % scale explains (three in 1.5 s: a ladder; back within 0.5 s: a punch;
   held: a reframed jump cut); whip = a transition several frames long. Validated against our own renders, whose
   beats are the ground truth. The same detectors read the render in QA (energy check).
20. **Baked effects and measured sounds.** RGB split and slice glitch are FFmpeg filters enabled only in their
   windows (`fxBakeFilter`), baked once into the footage like the colour pop's black-and-white copy: footage
   treatment goes through FFmpeg, never CSS filters (HyperFrames' contract says the same). Effects on one layer (camera, overlay, baked)
   never overlap, and the 10 s budget is checked around every effect, not just the new one. Every SFX file is
   measured once (`lib/sfx.ts`: attack, peak, level, cached in `assets/sfx/catalog.json`): a cue is where the sound
   lands (attack, or a whoosh's peak), and each kind plays at its median level. Render workers: on 4 cores without
   GPU, more Chrome workers made capture slower (1: 134 s, 2: 141 s, 3: 165 s for 17 s); `--workers` /
   `STUDIO_RENDER_WORKERS` exist for bigger machines.
21. **Quality over render time** (the maintainer's call, 2026-10-25). Long renders are accepted: an effect is never
   dropped or simplified to save CPU time, and decisions 8, 10, 14 and 20 stand only on their other reasons. Motion
   follows the HyperFrames skills (see Skills).
22. **A long edit runs as tickets** (the maintainer's call, 2026-10-25). One agent session that edits a whole video
   (cut review, beats, render, QA, correction rounds, second format) outgrows ~140 k tokens: the
   `video-intro-funk-v2` session did. Studio splits a project's work into tickets (`work/<project>/tickets/`, the
   format of `.scratch/tickets/`, so one `ticket` skill reads both): a deterministic default, one ticket per step and
   per part of an assembly, written at creation and after each QA, which the agent reviews through `studio_tickets`
   propose/show/set (decision 2). `studio_ticket_next`, `studio_ticket_close` and the MCP prompts hide the tree, and
   every call is journaled (decision 12). Tickets run only in a loop, because Claude Code cannot clear a context on
   its own (hooks cannot run `/clear`; `/loop` stays one conversation): a driver session runs each ticket in a fresh
   subagent and grows by one summary per ticket, and `claude -p` per ticket is the headless form. A review gate is a
   checkpoint ticket: a subagent prepares it, the driver asks the user and waits (subagents cannot ask), a second
   subagent applies the answer. `loop.md` is versioned, being a process; the tickets stay local.

## HyperFrames contract (the parts that bit us)

- One paused GSAP timeline registered as `window.__timelines["main"]`; no `Date.now()`, no unseeded random.
- Timed elements carry `class="clip"`, `data-start`, `data-duration`; never tween `visibility` on them.
- Do not repeat `fromTo` on one target (its `from` leaks into earlier seeks): `set` a baseline, then `to`.
- Fonts by name only if bundled (Inter, Montserrat, Oswald, League Gothic, Archivo Black, Playfair Display,
  JetBrains Mono, Poppins…); others need `@font-face` with a local file.
- No `data-color-grading` (see decision 8). GSAP is copied from `node_modules` into each project (`assets/gsap.min.js`); never load it from a CDN.
- `hyperframes check --json` prints one indented JSON report with sections `lint`, `runtime`, `layout`, `motion`,
  `contrast`, `craft`; `film_silent` is expected (sound is muxed later).

## Skills

Load the matching skill before the work. Where a skill disagrees with a numbered decision, the decision wins.

Motion: the HyperFrames skills, written for a newer CLI than the pinned one (check a command with
`npx hyperframes --help` first).
- `motion-doctrine`, then `cut-the-curve`: writing or changing an animation, a transition or an effect (`html.ts`,
  `stage.ts`, `contextual.ts`, `captions.ts`, `effects.ts`, assembly transitions). `seam-craft`: a white flash or a
  dip at a seam.
- `oversized-cursor`: a cursor, a click or a typing run.
- `captions-overlay`: captions and behind-words. Studio's captions are its *rail*, behind-words its *embed*.
- `hyperframes`: the render contract and its references (`captions.md`, `motion.md`, `overlays.md`,
  `types/vertical.md`). Studio's pipeline and review gates stand in for its work loop, project layout and
  desktop-app steps; media comes from local tools only (decision 17).
- Overrides: `.drift` is motion-doctrine's *camera with intent*, one monotonic push or pull per take. A
  `cut-the-curve` template is ported from its worker version (`set` a baseline, then `to`). The vector ledger and
  `seam-gate.mjs` work on a single-timeline composition (`films/video-intro-funk-v2`, and studio's
  `05-compose/<format>`, ticket 0008). Run it with `CHROME_PATH` (HyperFrames' chrome-headless-shell) and
  `--server-cmd "<repo>/node_modules/.bin/hyperframes preview --foreground --no-open --port {port}"`, so it uses the
  pinned CLI (its default is `npx --yes hyperframes`). It assumes a 1920×1080 viewport, so in 9:16 pick ledger
  selectors above y = 1080. On studio compositions trust the vector rows (`*-moving`, `*-direction`, `z-sign-scan`);
  `zero-overlap` fails by construction, since the rush plays under every overlay and the gate reads opacity, not
  occlusion. Put `cut` on the frame the incoming side ignites: a take's `.cam` `set` inside the window reads as
  velocity. Until compose writes the ledger (ticket 0025), judge seams on frames.

Code: `mattpocock-skills:<name>`.
- `tdd`: every change to `cutplan.ts`, `beats.ts` or `html.ts`, and every bug fix; the seams are their exported
  functions, the tests live in `test/`.
- `diagnosing-bugs`: a wrong cut, matte, placement or render; reproduce it on the fixture or in a failing test first.
- `codebase-design`: a new step, or a module whose interface changes.
- `domain-modeling`: a fuzzy term (rush, take, part, beat, window…) goes to `GLOSSARY.md`; decisions stay in the
  numbered list above, which is the project's ADR log.
- `grilling`: before revising a numbered decision.
- `prototype`: a look or a transition tried outside `src/` before it goes in.
- `research`: a question on HyperFrames, FFmpeg, a model or a licence.
- `code-review`: reviewing a branch or work in progress, with this file as the standards source.
- `writing-for-agents`: editing this file, `skills/studio/SKILL.md` or a recipe brief.
- `pr`: a PR body, when the maintainer asks for one.
- `wizard`: a setup step only the maintainer can perform.

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
- A plan becomes tickets in `.scratch/tickets/` (`README.md` lists them), each sized for one session and carrying its
  own context. `/loop` on `.scratch/tickets/loop.md` runs them one by one, each in a fresh subagent; a ticket marked
  `checkpoint: mainteneur` is run by hand (`/clear`, then `/ticket NNNN`).
- Never commit or push unless the maintainer asks.
