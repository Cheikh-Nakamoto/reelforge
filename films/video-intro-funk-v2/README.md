# video-intro-funk-v2 — a music-only film, made by hand

The XewXew intro (~50 s, 9:16 and 16:9, no voice, "WA WA WA FUNK (Remix SLOWED)"): script in
`~/ambiance/marketing/videos/video-5-intro-funk/README.md`, media in
`~/xewxew-medias/marketing/videos/video-5-intro-funk/` (never in a repo). There is no rush, so the studio pipeline
does not apply: one script generates the HyperFrames composition per format. Copy this folder as the start of the
next film of this kind. What was decided and measured: `REVIEW.md`.

## Steps

1. **Working folder.** `./setup.sh` (env `MEDIA`, `FONTS`, `WORK`; defaults in its header). Done when it prints
   `ready:`. Generated files live in `work/video-intro-funk-v2/` (gitignored).
2. **Measure the track** before placing anything. Beats from `npx hyperframes beats` (kept here as
   `wawawa.beats.json`), the grid fitted on the drum sections, then RMS per sixteenth on the low band (< 150 Hz)
   to find the bass entry, the drop, the breakdown and the hits. Done when every chapter boundary in the
   storyboard sits on a measured beat.
3. **Storyboard.** `node storyboard.mjs` and `FMT=16x9 node storyboard.mjs`. Motion follows `motion-doctrine` and
   `cut-the-curve`; every seam goes into the ledger the script writes (`ledger.json`, `ledger-16x9.json`).
4. **Gates.** In each `work/.../05-compose/<fmt>`: `npx hyperframes check --json` (ok, each warning kept on purpose
   is named in `REVIEW.md`), then from the repo root:
   `CHROME_PATH=~/.cache/hyperframes/chrome/chrome-headless-shell/linux-*/chrome-headless-shell-linux64/chrome-headless-shell node ~/.claude/skills/motion-doctrine/scripts/seam-gate.mjs verify --ledger films/video-intro-funk-v2/ledger.json --project work/video-intro-funk-v2/05-compose/9x16`.
   Done when both print `SEAM GATE: PASSED`.
5. **Look** with `npx hyperframes snapshot --describe false --at …` on every beat and between the frames of each
   big move, in both formats.
6. **Render.** `FMT=9x16 ./finish.sh`, then `FMT=16x9 ./finish.sh`: render (delivery, 1 worker), loudnorm to
   −14 LUFS / −1.6 dBTP, provenance tag, contact sheet in `work/.../08-qa/`. Done when the sheet is read second by
   second and the hits are measured on their frames in the rendered audio.
7. **Deliver** to the media folder's `exports/` with a version suffix, next to earlier versions.

## Gotchas met on this film

- The seam gate assumes a 1920×1080 viewport: in 9:16 anything below y = 1080 counts as off-screen, so pick ledger
  selectors above that line. A waterfall cut passes when the last outgoing word's fade ends 0.02 s before the cut
  on a 0.2 s `power4.in` ramp.
- `--describe` on `snapshot` sends frames to Gemini when a key is set: always pass `--describe false`.
- A sheen (or any moving highlight) moves *inside* a fixed clipping layer; moving the clipping layer carries the
  clip with it.
- HyperFrames stamps `data-hf-id` on the composition during a check; ignore them when comparing builds.
