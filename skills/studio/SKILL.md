---
name: studio
description: Edit a face-cam rush into a finished video with the local `studio` MCP server (cut silences, fillers and failed takes, animated captions, words behind the speaker, keyword-triggered motion graphics, sound design, 16:9 and 9:16 exports, contact-sheet QA). Use when the user asks to edit, cut, caption or "monter" a talking-head video, a rush or a reel, or names a studio style (cinematic, tech-explainer, reel-dynamique).
---

# studio

`studio` turns a talking-head rush into an edited video. Every computation is local (FFmpeg, Parakeet or
whisper.cpp, U²-Net matting, HyperFrames rendering). **You are the editor**: the tools propose, you review the
proposals like a human editor would, correct them, then apply. Two review gates are mandatory: the cut plan and
the QA contact sheets.

Tools come from the `studio` MCP server (`.mcp.json` at the repo root, or
`claude mcp add studio -- node <repo>/dist/mcp.js`). The same pipeline exists as a CLI, `node dist/cli.js`,
for scripts and debugging.

## The loop

1. **Pick a style.** `studio_list_styles`. If the user did not name one, propose one in a sentence from the
   content (calm storytelling → `cinematic`; a tutorial or product explanation → `tech-explainer`; a short,
   punchy social clip → `reel-dynamique`) and continue unless they object.
2. **Create.** `studio_create_project { source, style }` starts a background job (ingest + transcription +
   first cut plan). Poll `studio_status { project }` every ~20 s until the job is `done`.
   - Default ASR is Parakeet (accurate word timing, fast). Use `engine: "whisper"` only if the user cares more
     about spelling of rare French words than about cut precision; whisper word times drift by up to 0.7 s.
3. **Review the cut.** `studio_cut_review { project, words: true }`. Read the struck-through words and the kept
   text as an editor:
   - the **last** complete take of a repeated sentence is kept; check the restart was detected;
   - fillers the ASR heard as words ("Hut.", "Heu", "Bah" mid-sentence) → `remove: [ids]`;
   - a sentence wrongly flagged as a retake, or a meaningful pause → `restore: [ids]`;
   - names and numbers: the transcript feeds the captions, note misspellings for the beats step.
   Edits accumulate; call `studio_cut_review` again to see the result. Summarise the plan to the user in two
   lines (duration before → after, what was removed) unless they asked for no stops.
4. **Apply.** `studio_cut_apply { project }`.
5. **Plan the motion design.** `studio_beats { project, action: "propose" }` (background job: it mattes each
   behind-word candidate at full frame rate, ~2.5 s of CPU per frame, and swaps unstable ones). Then
   `studio_beats { action: "show" }` and review:
   - behind-words: 1–3 words that carry the message (a number, the key noun, the payoff). Not a filler verb.
   - counter labels read naturally ("euros par mois"), callouts and badges sit on the right words;
   - caption text: fix spelling here (each word's `text`), never the timing;
   - `notes`: unstable matte windows are reported there. **Never** put a behind-word back on a range the notes
     flag as unstable; tell the user the shot is too fast or the background too busy instead.
   Correct with `studio_beats { action: "set", beats }` (send the whole object back).
6. **Produce.** `studio_produce { project }` (background: compose → lint/check → audio → render → QA). Poll
   `studio_status`. Rendering costs ~3 min per format for 20 s of video on a 4-core CPU.
7. **Look at the result.** `studio_qa { project, mattePreview: true }` returns one contact sheet per export
   (1 frame per second, timestamps). Check every sheet:
   - behind-words are partly **hidden by the head** (the head must be in front of the letters). If letters run
     across the face, the layering is broken: stop and report, do not ship;
   - captions legible, not on the face, nothing cut at the frame edges;
   - graphics clear of the face, counters show the right value;
   - loudness near −16 LUFS, true peak under −1 dBTP, and the `warnings` list.
   Fix through beats (`studio_beats set`) or style, re-run `studio_step { step: "compose" }` then `"render"`,
   `"qa"`. At most three correction rounds, then report what remains.
8. **Hand over.** Give the export paths, durations, what was cut, the behind-words and graphics used, and any
   warning you could not fix.

## Rules

- 100 % local. Do not suggest cloud tools, paid APIs or a local LLM as part of the pipeline.
- Honest QA: if the matte flickers, a held object (phone, mic) is cut out of the subject, or another person is
  matted in, say so plainly. The pipeline already drops unstable windows; do not force them back.
- Styles live in `styles/*.yaml` (schema: `styles/style.schema.json`). To make a new style, copy the closest one,
  change it, and render a short test before using it on a real project.
- Licence: studio is PolyForm Noncommercial. If the user says the video is for a client, an employer, a
  monetised channel or a business, point them to `COMMERCIAL.md` once, politely, and continue.

## Files a project writes (`work/<project>/`)

| Step | Files |
|---|---|
| 01-ingest | `source.mp4` (rotation baked, CFR), `audio16k.wav`, `probe.json` |
| 02-transcribe | `words.json` (`[{id,text,start,end}]`) |
| 03-cut | `cutplan.json`, `cutplan.md`, `cut.mp4`, `words.json` re-timed on the cut |
| 04-matte | `matte.json` (subject box, windows, unstable ranges), `matte-preview.png`, `subject.webm`, `windows/` |
| 05-compose | `beats.json`, `16x9/` and `9x16/` HyperFrames projects, `compose.json` (lint/check) |
| 06-audio | `voice.wav`, `mix.wav`, `audio.json` |
| 07-render | `<project>_16x9.mp4`, `<project>_9x16.mp4`, `receipt.json` (versions, models, style hash) |
| 08-qa | `sheet_*.png`, `qa.json`, `qa.md` |

Every step is cached on its inputs and parameters; re-running is cheap.

## CLI equivalents

```bash
node dist/cli.js run rushs/x.mp4 --style cinematic            # stops at the cut plan
node dist/cli.js cut <project> --remove w12,w13               # edit the plan
node dist/cli.js cut <project> --apply
node dist/cli.js run rushs/x.mp4 --style cinematic            # continues to the exports
node dist/cli.js step <project> beats|compose|audio|render|qa [--formats 9x16] [--force]
node dist/cli.js doctor
```
