# studio

**Local, agent-driven video editing for face-cam rushes.** Drop in a raw talking-head recording, get back an
edited video in 16:9 and 9:16: silences, hesitations and failed takes cut, animated captions, words *behind*
the speaker, motion graphics triggered by what is said, sound design and loudness to −16 LUFS. Every model and
every frame runs on your machine.

> **FR —** studio transforme vos rushs face caméra en vidéos montées, entièrement en local : coupe des silences,
> hésitations et prises ratées, sous-titres animés, mots derrière le sujet, motion graphics déclenchés par la
> parole, sound design, exports 16:9 et 9:16. Piloté par un agent (Claude Code, Cursor…) via MCP, ou en CLI.
> Licence **non commerciale** : tout usage commercial passe par l'auteur, voir [COMMERCIAL.md](COMMERCIAL.md).

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

No paid API, no cloud, no telemetry, no LLM inside the pipeline.

## Features

- **Cut plan you can read.** Fillers ("euh", "bah"), stutters and failed takes (a sentence restarted, or
  announced with "je recommence") are struck through in `cutplan.md`; long pauses are tightened to a breath. Cut
  points snap to measured silences, so ASR timing drift never clips a syllable.
- **Words behind the speaker.** 1–3 strong words (loud, held, clause-final, numbers) slide in between the
  background and the person. The person is matted only around those words, each window is checked for flicker,
  and unstable ones are replaced — never shipped.
- **Animated captions** grouped on pauses and clause ends, active word highlighted (pop, rise or karaoke).
- **Motion graphics on cue**: counters for spoken numbers ("50 € par mois"), callouts, underlines, badges and list
  steps triggered by a per-style lexicon.
- **Camera**: alternating framing on jump cuts, punch-in on emphasis, colour grade, grain, vignette, letterbox.
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
| `cinematic` | unhurried rhythm, serif captions rising word by word, one tracked-out word behind the subject, contrast grade, grain, 2.39 letterbox in 16:9 |
| `tech-explainer` | boxed captions, monospace panels and counters, callouts on steps, traps and key ideas, clean grade, light zoom on cuts |
| `reel-dynamique` | tight cuts, alternating zoom on every cut, two-word uppercase captions mid-frame, up to three giant words behind the subject, punchy SFX |

Copy one to make your own; every key is documented in `src/lib/style.ts`.

## Requirements

- Linux or macOS, Node.js ≥ 22, FFmpeg (`sudo apt install ffmpeg`).
- About 3 GB of disk for models and the render browser, downloaded once into `~/.cache/hyperframes/`:
  Parakeet TDT 0.6B v3 (640 MB), U²-Net human segmentation (168 MB), chrome-headless-shell. whisper.cpp
  large-v3-turbo (1.6 GB, built from source) only if you choose the whisper engine.
- No GPU needed. Measured on a 4-core i5-7200U laptop without GPU, for a 30 s rush cut down to ~18 s: ingest
  60 s, transcription 23 s, cut 50 s, matte survey 50 s + ~2–3 min per behind-word, audio 10 s, render
  2–4 min per format. Roughly 12–20 minutes for both formats, depending on the style.

## Quick start

```bash
npm install            # builds dist/ too
npx hyperframes models install parakeet
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
`studio_doctor`, `studio_list_styles`, `studio_list_projects`.

## Known limits

- The matting model segments **people**: a phone or microphone held in hand is cut out of the subject (text then
  passes in front of it), and other people in frame are matted in too.
- Fast motion and busy backgrounds make the matte flicker; studio then drops the word rather than ship it, and says
  so in the QA warnings.
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
