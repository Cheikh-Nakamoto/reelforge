#!/usr/bin/env bash
# Build a synthetic French test rush: a scripted voice (Piper TTS, local) with fillers, a failed take, a restart
# marker, numbers and keywords, laid over a looping video of a person. It exercises every pipeline step, but it is
# not a real face-cam rush (no lip sync, synthetic fillers): validate quality on real footage too.
#
#   scripts/make-fixture.sh <video-with-a-person.mp4> [rushs/test-synth.mp4]
set -euo pipefail

src=${1:?usage: make-fixture.sh <video-with-a-person.mp4> [out.mp4]}
out=${2:-rushs/test-synth.mp4}
here=$(cd "$(dirname "$0")/.." && pwd)
cache="$here/.cache/fixture"
mkdir -p "$cache" "$(dirname "$out")"

if [ ! -x "$cache/venv/bin/python" ]; then
  python3 -m venv "$cache/venv"
  "$cache/venv/bin/pip" install -q piper-tts
fi
if [ ! -f "$cache/fr_FR-siwis-medium.onnx" ]; then
  (cd "$cache" && ./venv/bin/python -m piper.download_voices fr_FR-siwis-medium)
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
i=0
# pause after the phrase (s) | text
while IFS='|' read -r pause text; do
  i=$((i + 1))
  echo "$text" | "$cache/venv/bin/python" -m piper -m "$cache/fr_FR-siwis-medium.onnx" -f "$work/seg_$i.wav" 2>/dev/null
  ffmpeg -nostdin -v error -y -f lavfi -i anullsrc=r=22050:cl=mono -t "$pause" "$work/sil_$i.wav"
  printf "file '%s'\nfile '%s'\n" "$work/seg_$i.wav" "$work/sil_$i.wav" >> "$work/list.txt"
done <<'SCRIPT'
1.3|Aujourd'hui, je vais vous montrer comment monter une vidéo.
0.4|Euh,
0.5|la première chose, c'est le son.
0.9|Le budget est de trente
0.6|non attends, je recommence.
0.5|Le budget est de cinquante euros par mois.
1.1|Attention, c'est le piège le plus fréquent.
0.5|En trente jours, vous gagnez deux mille abonnés.
0.4|C'est simple, rapide, et totalement gratuit.
0.8|Euh,
0.3|voilà, à vous de jouer !
SCRIPT

ffmpeg -nostdin -v error -y -f concat -safe 0 -i "$work/list.txt" -ar 48000 -ac 1 "$work/voice.wav"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$work/voice.wav")
ffmpeg -nostdin -v error -y -stream_loop -1 -i "$src" -i "$work/voice.wav" -map 0:v -map 1:a -t "$dur" \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30" \
  -c:v libx264 -crf 18 -preset fast -c:a aac -b:a 192k "$out"
echo "$out (${dur}s)"
