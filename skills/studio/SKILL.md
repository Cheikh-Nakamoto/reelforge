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

## Dashboard

At the start of a session, call `studio_dashboard` and give the user its URL: they can follow each step, see the
render on a timeline and read the journal of your tool calls (every call you make is recorded with its arguments, so
keep arguments meaningful).

## Recipes and the questionnaire

A recipe is a validated way of editing a kind of video: an editing brief (follow it), a style with overrides,
formats and, for several rushes, the expected structure. They live in `recipes/*.yaml`; each is also an MCP prompt
the user can select (`/mcp__studio__demo-produit`, `/mcp__studio__questionnaire`…).

- The user names a kind of video or a recipe → `studio_create_project { source, recipe }` and follow the returned
  `brief`.
- The user does not know → `studio_questionnaire`, ask all questions in one go (multiple choice), show the outcome
  with `studio_recipe_preview { answers }`, then `studio_create_project { source, answers }`.
- The user validates a montage ("c'est bon", "garde ce style") → offer to save it: `studio_recipe_save { project,
  name, prompt }`, with a brief written from what they liked and what they asked you to change.
- The user shows a video to imitate ("monte comme ça", a reel they like) → `studio_reference { file }`: it returns
  the measured energy (cuts/s, flashes, punches, shakes, whips, zoom ladders, strobes), the overrides that
  reproduce it, the reasons, and one frame per shot. Look at the frames to pick the caption look (bold, pill,
  editorial, minimal) yourself, then `studio_create_project { source, style, like: file }` (or `like` in an
  assembly spec). `saveRecipe { name, style }` keeps it as a recipe. Tell the user what was measured, in a sentence.

## The loop

1. **Pick a style.** Skip when a recipe or answers were given. `studio_list_styles`. If the user did not name one, propose one in a sentence from the
   content (calm storytelling → `cinematic`; a tutorial or product explanation → `tech-explainer`; a short,
   punchy social clip → `reel-dynamique`) and continue unless they object.
2. **Create.** `studio_create_project { source, style }` starts a background job (ingest + transcription +
   first cut plan). Poll `studio_status { project }` every ~20 s until the job is `done`.
   - Default ASR is `hybrid` (whisper's words, Parakeet's word times). Brand names and URLs are often misheard
     ("khemrafa.clic" for xewxew.click): look at the footage and fix them in the beats captions.
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
   - behind-words are the *embed* (`captions-overlay`), the scarce peak: 1–3 words that carry the message (a
     number, the key noun, the payoff), one per sentence at most, never two on screen together, a beat apart. Not a
     filler verb. The captions are the *rail*: every kept word, verbatim, the key word as its inline punch;
   - counter labels read naturally ("euros par mois"), callouts and badges sit on the right words;
   - contextual graphics: `hook` (opening title: two words that say what the video is about; rewrite `items` if the
     pick is weak), `url` (typed address bar), `question`, `compare` (A vs B), `definition`, `cta` (last third).
     Drop any that misreads the sentence;
   - caption key words (`emphasis`, index in the group) and `emoji`: one per group at most, never on a sad or
     serious sentence. Groups are 2–3 words: keep them short, merge only a word left alone that reads wrong.
     The look comes from the style (`captions.look`: bold, pill, editorial, minimal; `captions.animation`: pop,
     slam, rise, karaoke) and can be changed per project in its style overrides;
   - caption text: a brand, a URL or a name misheard everywhere ("khemrafa.clic" for xewxew.click) is fixed once
     with `studio_fix_words { project, replace }` on the transcript, then `studio_beats propose`; a one-off typo
     can be fixed in the beats (each word's `text`), never the timing;
   - `fx` (shake, zoomPunch, flash, whip, strobe, ladder, glitch, rgbSplit, lightLeak, colorPop): each has a
     `reason`. Keep them on moments that deserve them; delete one that lands on a calm or sad sentence, or on a cut
     between two sentences of the same thought. Fewer is better: the style already caps the density. A glitch suits
     tech words (bug, erreur, hack), a strobe a shout ("attention"), a ladder the opening of a long take; two
     effects that drive the same layer (camera: shake/zoomPunch/whip/ladder; overlay: flash/strobe) must not
     overlap. Add a matching `sfx` cue when you add an effect (glitch → glitch, strobe → hit, ladder → a click per
     step); a cue is where the sound lands (a whoosh's peak, any other sound's attack);
   - timing follows `motion-doctrine`: an effect and its sound land on the frame of their cause (the word's start,
     the cut), not a few frames later; keep 0.3–0.75 s of stillness before a payoff (a behind-word, a stage scene,
     a counter's last value), so move or delete an effect that fills it; a graphic leaves once its job is done
     (shorten its `end` when it only sits there);
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
   - loudness near −16 LUFS, true peak under −1 dBTP, and the `warnings` list;
   - with a reference (`like`), the "Énergie" warnings compare the render's cuts and effects per 10 s with the
     reference's: a calmer edit gets a tighter cut plan or a few more effects on strong moments, never on a sad
     or serious sentence.
   Fix through beats (`studio_beats set`) or style, re-run `studio_step { step: "compose" }` then `"render"`,
   `"qa"`. At most three correction rounds, then report what remains.
8. **Hand over.** Give the export paths, durations, what was cut, the behind-words and graphics used, and any
   warning you could not fix.

## Several rushes in one video

When the user has an intro, a screen recording, an explanation… for one video, write an assembly spec and call
`studio_assemble { spec }` (CLI: `studio assemble spec.yaml`):

```yaml
name: my-short            # the output project
style: tech-explainer
parts:
  - project: intro        # or source: rushs/intro.mp4 (a project is created)
  - project: demo
    kind: screen          # screen recording: no speaker to cut out (detected when omitted)
  - project: explanation
    reduce: { mode: bubble, broll: demo, from: 8 }   # speaker in a corner bubble over the demo
transitions: [smoothleft] # every junction rides one direction
```

Transitions follow `motion-doctrine`: one *current* and 2–3 kinds repeated. Set `transitions` in every spec (the
default cycle mixes three directions): `smoothleft` for an ordinary junction, `zoomin` only where the next part goes
deeper into the same thought, `cut` for a hard cut. Every junction carries motion across the cut, so the fades
(`fade`, `fadeblack`, `fadewhite`, `dissolve`) stay out.

Order the parts by what is said ("comme je l'expliquais tantôt" comes after the demo). Each part's cut plan must be
reviewed (`studio_cut_review` / `studio_cut_apply` on that part) before the assembly is built; then continue with
`studio_beats` and `studio_produce` on the assembly's name. `frames` in the beats are the reductions: a `card`
gives a counter or list room, a `bubble` shows B-roll behind the speaker. Check on the contact sheet that nothing
important of the screen recording is hidden under the bubble.

## A film with no rush

Music-only motion design (a product intro on a track, no speaker) skips the pipeline: copy
`films/video-intro-funk-v2/` and follow its README (setup, measure the track, storyboard, check and seam gate,
render).

## Rules

- 100 % local. Do not suggest cloud tools, paid APIs or a local LLM as part of the pipeline.
- Quality over render time: keep an effect, a scene or a correction round whatever the render costs.
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
