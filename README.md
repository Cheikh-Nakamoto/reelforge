# studio

**Local, agent-driven video editing for face-cam rushes.** Drop in a raw talking-head recording, get back an
edited video in 16:9 and 9:16: silences, hesitations and failed takes cut, animated captions, words *behind*
the speaker, motion graphics triggered by what is said, sound design and loudness to −16 LUFS. Every model and
every frame runs on your machine.

> **FR —** studio transforme vos rushs face caméra en vidéos montées, entièrement en local : coupe des silences,
> hésitations et prises ratées, sous-titres animés, mots derrière le sujet, motion graphics déclenchés par la
> parole, sound design, exports 16:9 et 9:16. Piloté par un agent (Claude Code, Cursor…) via MCP, ou en CLI.
> Licence **non commerciale** : tout usage commercial passe par l'auteur, voir [COMMERCIAL.md](COMMERCIAL.md).
>
> 📖 **Documentation complète (en français)** : [docs/](docs/README.md). Elle couvre l'installation, la
> connexion à Claude Code, Codex, Antigravity, Cursor, VS Code et à tout autre client MCP, un premier montage pas
> à pas, chaque étape du pipeline, les styles, les recettes, le dépannage et la référence complète.

**Full documentation** (French): [docs/](docs/README.md), covering installation, MCP client setup (Claude Code,
Codex, Antigravity, Cursor, VS Code…), a first edit step by step, every pipeline step, styles, troubleshooting and
the full reference.

```
rush.mp4 ─▶ ingest ─▶ transcribe ─▶ cut ──▶ matte ─▶ compose ─▶ audio ─▶ render ─▶ qa
            FFmpeg    Parakeet /    plan      U²-Net   HyperFrames  FFmpeg    16:9      contact
                      whisper.cpp   to review (local)  + GSAP       −16 LUFS  9:16      sheets
                                    ▲                    ▲                               │
                                    └──── the agent reviews and edits ◀──────────────────┘
```

## Why

Editing a talking-head video is mostly mechanical work around a few editorial choices: which take to keep,
which word deserves to be big, where a number should count up. studio does the mechanical part with specialised
local models and plain heuristics, and exposes every choice as a readable, editable file. An LLM agent driving it
over MCP plays the editor: it reads the cut plan and the motion plan, corrects them, renders, then **looks at the
result** (contact sheets) and fixes what is wrong.

No paid API, no cloud, no telemetry, no LLM inside the pipeline. The agent, though, reads what it reviews (the
transcript, the cut and motion plans, the contact sheets) through its own model: with a hosted model (Claude,
GPT, Gemini…) those go to its provider, while the video and audio files stay on your machine. For nothing to leave
it, drive studio from the CLI or from a client running a local model.

## Features

- **Cut plan you can read.** Fillers ("euh", "bah"), stutters and failed takes (a sentence restarted, or
  announced with "je recommence") are struck through in `cutplan.md`; long pauses are tightened to a breath. Cut
  points snap to measured silences, so ASR timing drift never clips a syllable.
- **Punchline scenes.** The strongest short sentences cut to full-screen kinetic typography: every word slams
  in on the beat it is spoken, with motion blur and a landing shake; the key word gets an extruded 3D face.
- **Screen recordings in a floating 3D phone**, with transitions between assembled parts (zoom, iris, blur) and a
  slow camera push on every take. Everything renders on CPU: the heavier the style, the longer the render.
- **Contextual motion design.** What is said picks the graphic: a spoken number counts up, a URL types itself in an
  address bar, "X au lieu de Y" becomes an A-vs-B card, "c'est-à-dire" a definition, a question a question card, a
  closing "abonnez-vous" a call-to-action button, and the opening sentence a 3D title.
- **Short-form captions.** Two or three words at a time, large and heavy, legible without a box (outline and hard
  shadow), never ending on an article; the spoken word marked and the key word bigger on its own line. Four looks:
  `bold` (Hormozi / Beast: the spoken word turns accent and pops), `pill` (it hops onto an accent pill), `editorial`
  (key word in a serif italic) and `minimal` (white, no colour). A contextual emoji (💰 ⏱️ 🌐 🎉…) pops above as a
  sticker when a word calls for it. Graphics tip in with CSS 3D perspective.
- **Words behind the speaker.** 1–3 strong words (loud, held, clause-final, numbers) slide in between the
  background and the person. The person is matted only around those words, each window is checked for flicker,
  and unstable ones are replaced — never shipped.
- **Edit like a reference.** `studio reference clip.mp4` (or `studio_reference`) measures a reel you admire on your
  machine — cuts per second, white flashes, strobes, zoom punches, jump-zoom ladders, shakes, whip pans, brightness,
  saturation, letterbox — and turns it into style overrides; `--like clip.mp4` on `run` / `assemble` applies them,
  `--save-recipe` keeps them as a recipe, and the QA compares the render's energy with the reference's. Pixel
  arithmetic on 96-px grey frames, no model, nothing uploaded (the local take on Higgsfield Katana's reference read).
- **Animated captions** grouped on pauses, commas and clause ends; the group pops up, or each word lands as it is
  spoken (slam, rise), or lights up karaoke-style.
- **Motion graphics on cue**: counters for spoken numbers ("50 € par mois"), callouts, underlines, badges and list
  steps triggered by a per-style lexicon.
- **Camera**: alternating framing on jump cuts, punch-in on emphasis, colour grade, grain, vignette, letterbox.
- **Effects** (CapCut-style, rationed by a per-10 s budget, never two on one layer at once): zoom punch, shake,
  whip pan, white flash, strobe, zoom ladder (hard jump zooms), light leak, colour pop, and an RGB split and a slice
  glitch baked into the footage by FFmpeg inside their windows only (no browser filter, no render-time cost).
- **Sound effects placed by ear**: each library file is measured once (attack, peak, level); a cue lands on a
  sound's attack, or on a whoosh's peak, and every file of a kind plays at the kind's level.
- **Several rushes, one video**: an intro, a screen recording with voice-over and an explanation are cut
  separately, then joined; the speaker can shrink into a corner bubble over the screen recording, or into a card
  that leaves room for a counter or a list.
- **Robust on real phone audio**: pauses are measured against each rush's own noise floor, and the transcript
  takes whisper's words with Parakeet's word timings.
- **CapCut-style effects, rationed**: zoom punch and camera shake on strong words or spoken keywords ("boom",
  "stop"), white flash and whip pan on cuts, warm light leaks, and a colour pop (the world goes black and white,
  the speaker stays in colour) under behind-words. Each style sets which effects it allows and how many per 10 s.
- **Sound**: FFT denoise, compression, two-pass loudnorm to −16 LUFS, music bed with sidechain ducking,
  synthesised whoosh/pop/hit cues.
- **Both formats**: a vertical rush becomes a pillar-boxed 16:9 over a blurred plate; a landscape rush is cropped
  to 9:16 around the subject.
- **QA**: one contact sheet per export (1 frame per second, timestamps), loudness and true peak, HyperFrames
  `lint`/`check`, and a `receipt.json` of every version, model and parameter used.

## Styles

Three styles ship in `styles/` (YAML, schema in `styles/style.schema.json`):

| Style | Feel |
|---|---|
| `cinematic` | unhurried rhythm, editorial captions rising word by word (key word in serif italic), one tracked-out word behind the subject, contrast grade, grain, 2.39 letterbox in 16:9 |
| `tech-explainer` | pill captions (the spoken word on an accent pill), monospace panels and counters, callouts on steps, traps and key ideas, clean grade, light zoom on cuts |
| `reel-dynamique` | tight cuts, alternating zoom on every cut, bold two-word uppercase captions slammed in mid-frame, up to three giant words behind the subject, punchy SFX |

Copy one to make your own; every key is documented in `src/lib/style.ts`.

## Dashboard

`node dist/cli.js serve` (or the MCP tool `studio_dashboard`) opens a local page on http://127.0.0.1:4600 that shows,
for every project: the eight steps with their results and timings; the render with a multi-lane timeline synced to
it (parts, cuts, reduced frames, scenes, behind-words, graphics, effects, sounds, captions — click to seek); the cut
plan with each removed word and why; the motion plan; **the journal of what Claude did** (every MCP tool call with
its arguments, every pipeline step); QA sheets; versions and checks. Read-only, bound to localhost.

## Recipes and questionnaire

A montage you validate can be kept as a **recipe** (`recipes/*.yaml`): an editing brief for the agent, a style with
overrides, formats and the expected structure of the rushes. Three ship (`demo-produit`, `reel-viral`,
`storytelling`). A **questionnaire** (`recipes/questionnaire.yaml`: type of video, platform, tone, captions, rhythm,
footage, extras) picks a recipe and adjusts it from the answers. Over MCP every recipe is a selectable prompt
(Claude Code: `/mcp__studio__demo-produit`, `/mcp__studio__questionnaire`).

```bash
node dist/cli.js recipes
node dist/cli.js run rushs/demo.mp4 --recipe demo-produit
node dist/cli.js run rushs/demo.mp4 --answers '{"type":"Reel viral","ton":"Énergique"}'
node dist/cli.js recipe-save my-project my-recipe --title "Ma démo"
node dist/cli.js reference rushs/reel-que-j-aime.mp4                      # measured energy and look
node dist/cli.js run rushs/demo.mp4 --style reel-dynamique --like rushs/reel-que-j-aime.mp4
node dist/cli.js reference rushs/reel-que-j-aime.mp4 --save-recipe comme-ce-reel --style reel-dynamique
```

## Requirements

- Linux or macOS, Node.js ≥ 22, FFmpeg (`sudo apt install ffmpeg`).
- About 3 GB of disk for models and the render browser, downloaded once into `~/.cache/hyperframes/`:
  Parakeet TDT 0.6B v3 (640 MB), U²-Net human segmentation (168 MB), chrome-headless-shell. whisper.cpp
  large-v3-turbo (1.6 GB, built from source) only if you choose the whisper engine.
- No GPU needed. Measured on a 4-core i5-7200U laptop without GPU, for a 30 s rush cut down to ~18 s: ingest
  60 s, transcription 23 s, cut 50 s, matte survey 50 s + ~2–3 min per behind-word, audio 10 s, render
  2–4 min per format. Roughly 12–20 minutes for both formats, depending on the style.
- Render workers: HyperFrames picks the number of Chrome capture workers itself. On that 4-core laptop more
  workers made capture slower (17 s short: 1 worker 134 s, 2 → 141 s, 3 → 165 s; software raster already fills
  the cores). On a bigger render machine try `--workers N` (CLI) or `STUDIO_RENDER_WORKERS=N` (MCP server env);
  the frames are identical either way.

## Quick start

```bash
npm install            # builds dist/ too
npx hyperframes models install parakeet
scripts/fetch-sfx.sh     # optional: 45 CC0 sound effects (Kenney, OpenGameArt) into assets/sfx/
node dist/cli.js doctor

node dist/cli.js run rushs/my-video.mp4 --style tech-explainer   # stops at the cut plan
node dist/cli.js cut my-video --remove w12,w13                    # optional edits
node dist/cli.js cut my-video --apply
node dist/cli.js run rushs/my-video.mp4 --style tech-explainer   # continues to the exports
```

Exports land in `work/my-video/07-render/`, the QA in `work/my-video/08-qa/`.

### With an agent (MCP)

The repository carries `.mcp.json`, so Claude Code picks the server up when started in this folder, together
with the `studio` skill (`skills/studio/SKILL.md`) that tells the agent how to review each step. Elsewhere:

```bash
claude mcp add studio -- node /path/to/studio/dist/mcp.js
```

Then: *"Monte rushs/my-video.mp4 en style reel-dynamique."* Tools: `studio_create_project`, `studio_cut_review`,
`studio_cut_apply`, `studio_beats`, `studio_produce`, `studio_step`, `studio_qa`, `studio_status`,
`studio_reference`, `studio_doctor`, `studio_list_styles`, `studio_list_projects`.

## Known limits

- The matting model segments **people**: a phone or microphone held in hand is cut out of the subject (text then
  passes in front of it), and other people in frame are matted in too.
- Fast motion and busy backgrounds make the matte flicker; studio then drops the word rather than ship it, and says
  so in the QA warnings.
- The reference analysis counts full-frame switches (a colour pop to black and white, a huge title) as cuts, and
  does not read captions (no OCR): pick the caption look from the reference's frames.
- Speech recognition can miss or mis-hear hesitations ("euh" heard as a word); the agent review of the cut plan is
  where they are caught.
- Tested in French only so far, on a synthetic fixture; real-footage tests are in progress. Other languages
  Parakeet covers should transcribe, but the filler, restart and stop-word lexicons in `src/lib/words.ts` are
  French.

## Licence

studio is released under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**: free for personal, research,
educational, non-profit and other noncommercial use. **Commercial use requires a separate licence** from the
author — read [COMMERCIAL.md](COMMERCIAL.md) before using it for a client, a business or a monetised channel.
This is a source-available licence, not an OSI-approved open-source licence.

Rendered videos carry a metadata tag naming studio and its licence (container metadata, no visible watermark).

Third-party software and models keep their own licences: [THIRD_PARTY.md](THIRD_PARTY.md). studio builds on
[HyperFrames](https://github.com/heygen-com/hyperframes) and learned from
[ghost-editor](https://github.com/kurbaitaev/ghost-editor) and [Kinocut / mcp-video](https://github.com/KyaniteLabs/kinocut).

Contributions are welcome: [CONTRIBUTING.md](CONTRIBUTING.md).
