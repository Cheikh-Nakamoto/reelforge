#!/usr/bin/env bash
# Build the working folder the storyboard renders from: media from the XewXew media folder (never versioned), the
# screen recordings cropped to the page, fonts, GSAP and the HyperFrames config, for both formats.
#   MEDIA  the media folder (default ~/xewxew-medias/marketing/videos/video-5-intro-funk)
#   FONTS  a folder with Fraunces.ttf, Fraunces-Italic.ttf and Geist.ttf (Google Fonts, OFL)
#   WORK   the working folder (default <repo>/work/video-intro-funk-v2)
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SRC/../.." && pwd)"
MEDIA=${MEDIA:-$HOME/xewxew-medias/marketing/videos/video-5-intro-funk}
FONTS=${FONTS:-$ROOT/work/video-intro-funk/05-compose/9x16/assets/fonts}
WORK=${WORK:-$ROOT/work/video-intro-funk-v2}
A="$WORK/05-compose/9x16/assets"

for f in Fraunces.ttf Fraunces-Italic.ttf Geist.ttf; do
  [ -f "$FONTS/$f" ] || { echo "missing $FONTS/$f: download Fraunces and Geist from Google Fonts (OFL) and set FONTS" >&2; exit 1; }
done
[ -d "$MEDIA/videos" ] || { echo "no media in $MEDIA (set MEDIA)" >&2; exit 1; }

mkdir -p "$A/fonts" "$A/music" "$A/media/images" "$A/media/videos-fixed" "$WORK/05-compose/16x9/assets" "$WORK/07-render" "$WORK/08-qa"
cp "$FONTS"/*.ttf "$A/fonts/"
cp "$ROOT/node_modules/gsap/dist/gsap.min.js" "$A/"
cp -r "$MEDIA/images/photos-modeles" "$MEDIA/images/ecrans" "$A/media/images/"
cp "$MEDIA/music/WA WA WA FUNK (Remix SLOWED).mp3" "$A/music/wawawa.mp3"
# The recordings hold the page in their top-left 540×1168 px only (the capture window was smaller than the video).
for v in "$MEDIA"/videos/*.mp4; do
  out="$A/media/videos-fixed/$(basename "$v")"
  [ -f "$out" ] || ffmpeg -v error -y -i "$v" -vf crop=540:1168:0:0 -an -c:v libx264 -crf 14 -preset slow -pix_fmt yuv420p "$out"
done
cfg='{ "paths": { "blocks": "compositions", "components": "compositions/components", "assets": "assets" }, "media": { "autoProxy": true } }'
echo "$cfg" > "$WORK/05-compose/9x16/hyperframes.json"
echo "$cfg" > "$WORK/05-compose/16x9/hyperframes.json"
# 16:9 shares the 9:16 assets; its sound effects are copied by the storyboard.
for d in fonts media music gsap.min.js; do ln -sfn "../../9x16/assets/$d" "$WORK/05-compose/16x9/assets/$d"; done
[ -f "$WORK/project.json" ] || cat > "$WORK/project.json" <<EOF
{ "name": "video-intro-funk-v2", "source": "$MEDIA", "style": "reel-dynamique", "formats": ["9x16", "16x9"] }
EOF
echo "ready: $WORK"
