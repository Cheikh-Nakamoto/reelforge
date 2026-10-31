#!/usr/bin/env bash
# Rend les 3 vidéos du teaser « Coming Soon » (wolof/fr/en, 9:16) et fait leur planche contact.
# La musique est déjà masterisée (~-14 LUFS, pic sain) : pas de re-loudnorm.
set -euo pipefail
export LC_ALL=C HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_SKIP_SKILLS=1
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-$ROOT/work/xewxew-coming-soon}"
HF="$ROOT/node_modules/.bin/hyperframes"
mkdir -p "$WORK/07-render" "$WORK/08-qa"

for LANG in wolof fr en; do
  echo "== render $LANG =="
  (cd "$WORK/05-compose/$LANG" && "$HF" render --output "../../07-render/xewxew-coming-soon_$LANG.mp4" --quality delivery --workers 1 2>&1 | tail -4)
  ffmpeg -v error -y -i "$WORK/07-render/xewxew-coming-soon_$LANG.mp4" \
    -vf "fps=1,scale=200:-2,tile=8x7:padding=6:margin=6:color=0x202020" \
    -frames:v 1 -update 1 "$WORK/08-qa/sheet_$LANG.png"
  echo "done $LANG"
done
echo "ALL DONE"
