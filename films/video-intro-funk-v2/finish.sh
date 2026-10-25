#!/usr/bin/env bash
# Render the composition, master its sound to -14 LUFS / -1 dBTP, tag it, and make the QA sheet.
# FMT=9x16 (default) or FMT=16x9; regenerate the composition first with `FMT=<fmt> node storyboard.mjs`.
set -euo pipefail
export LC_ALL=C HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_SKIP_SKILLS=1
SRC="$(cd "$(dirname "$0")" && pwd)"
cd "${WORK:-$SRC/../../work/video-intro-funk-v2}"
F=${FMT:-9x16}
NAME=video-intro-funk-v2
L() { node "$SRC/log.mjs" "$1" "${2:-log}"; }
L "Rendu $F lancé (qualité delivery, 1 worker : sur 4 cœurs sans GPU, plus de workers ralentissent la capture)." step
t0=$(date +%s)
(cd 05-compose/$F && npx hyperframes render --output ../../07-render/picture_$F.mp4 --quality delivery --workers 1 > ../../07-render/render_$F.log 2>&1)
t1=$(date +%s)
L "Rendu $F terminé en $((t1 - t0)) s." step
ffmpeg -v error -y -i 07-render/picture_$F.mp4 -vn -ac 2 -ar 48000 -c:a pcm_s24le 07-render/mix-raw_$F.wav
m=$(ffmpeg -hide_banner -nostats -i 07-render/mix-raw_$F.wav -af loudnorm=I=-14:TP=-1.6:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
get() { echo "$m" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ffmpeg -v error -y -i 07-render/mix-raw_$F.wav -af "loudnorm=I=-14:TP=-1.6:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true,aresample=48000" -c:a pcm_s24le 07-render/mix_$F.wav
ffmpeg -v error -y -i 07-render/picture_$F.mp4 -i 07-render/mix_$F.wav -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart -map_metadata -1 \
  -metadata comment="Made with studio (local, PolyForm Noncommercial 1.0.0). Music: WA WA WA FUNK (Remix SLOWED)" \
  -metadata encoder=studio 07-render/${NAME}_$F.mp4
loud=$(ffmpeg -hide_banner -nostats -i 07-render/${NAME}_$F.mp4 -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|Peak:" | tail -2 | tr -s ' ' | tr '\n' ' ')
ffmpeg -v error -y -i 07-render/${NAME}_$F.mp4 -vf "fps=1,scale=$([ "$F" = 16x9 ] && echo 360 || echo 200):-2,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='%{pts\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4,tile=$([ "$F" = 16x9 ] && echo 5x11 || echo 8x7):padding=6:margin=6:color=0x202020" -frames:v 1 -update 1 08-qa/sheet_$F.png
L "Export : 07-render/${NAME}_$F.mp4 — son masterisé ($loud). Planche contact : 08-qa/sheet_$F.png." step
echo "done $((t1 - t0))s $loud"
