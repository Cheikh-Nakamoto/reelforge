#!/usr/bin/env bash
# Download a CC0 sound-effects library into assets/sfx/<kind>/ (whoosh, pop, hit, click, glitch), normalized for the mix.
# Sources, all CC0 (public domain, free for commercial use, no attribution required):
#   Kenney — Interface Sounds, Impact Sounds, Sci-Fi Sounds   https://kenney.nl
#   artisticdude — Swishes Sound Pack               https://opengameart.org/content/swishes-sound-pack
# The licence file of each Kenney pack is checked before anything is used. Nothing is executed from the downloads.
#
#   scripts/fetch-sfx.sh            (re-run to refresh; existing files are replaced)
set -euo pipefail
# Decimal points, not commas, in the numbers handed to ffmpeg (a French locale prints "5,90").
export LC_ALL=C

here=$(cd "$(dirname "$0")/.." && pwd)
dest="$here/assets/sfx"
work=$(mktemp -d)
# Some packs unzip into read-only folders: make them writable before removing them.
trap 'chmod -R u+w "$work"; rm -rf "$work"' EXIT

# Kenney asset pages link a zip whose URL carries a hash: read it from the page instead of hard-coding it.
kenney() {
  local slug=$1
  local url
  url=$(curl -sfL "https://kenney.nl/assets/$slug" | grep -oE "https://kenney.nl/media/pages/assets/$slug/[^\"']+\.zip" | head -1)
  [ -n "$url" ] || { echo "no download link found for kenney $slug" >&2; exit 1; }
  curl -sfL -o "$work/$slug.zip" "$url"
  mkdir -p "$work/$slug" && unzip -q -o "$work/$slug.zip" -d "$work/$slug"
  grep -q "Creative Commons Zero, CC0" "$work/$slug/License.txt" || { echo "kenney $slug is not CC0 any more, stopping" >&2; exit 1; }
}

kenney interface-sounds
kenney impact-sounds
kenney sci-fi-sounds
curl -sfL -o "$work/swishes.zip" https://opengameart.org/sites/default/files/swishes.zip
mkdir -p "$work/swishes" && unzip -q -o "$work/swishes.zip" -d "$work/swishes"

# kind | source glob (relative to $work) | optional length in seconds (long beds are cut, with a short fade)
picks=$(cat <<'EOF'
whoosh|swishes/swishes/swish-*.wav
pop|interface-sounds/Audio/drop_00[1-4].ogg
pop|interface-sounds/Audio/pluck_00[1-2].ogg
pop|interface-sounds/Audio/maximize_00[1-4].ogg
hit|impact-sounds/Audio/impactPunch_heavy_00[0-4].ogg
hit|impact-sounds/Audio/impactSoft_heavy_00[0-2].ogg
click|interface-sounds/Audio/click_00[1-5].ogg
click|interface-sounds/Audio/tick_00[1-2].ogg
glitch|sci-fi-sounds/Audio/computerNoise_00[0-3].ogg|0.5
glitch|sci-fi-sounds/Audio/forceField_00[0-2].ogg|0.5
EOF
)

rm -rf "$dest"/{whoosh,pop,hit,click,glitch}
count=0
while IFS='|' read -r kind glob len; do
  mkdir -p "$dest/$kind"
  for src in $work/$glob; do
    [ -f "$src" ] || continue
    name=$(basename "${src%.*}")
    out="$dest/$kind/$name.wav"
    # Peak-normalize to -3 dBFS: one-shots are too short for loudness measurement; the mix sets their level.
    peak=$(ffmpeg -nostdin -hide_banner -i "$src" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB.*/\1/p')
    gain=$(awk -v p="${peak:-0}" 'BEGIN { printf "%.2f", -3 - p }')
    cut=""
    [ -n "${len:-}" ] && cut=$(awk -v l="$len" 'BEGIN { printf "atrim=0:%s,afade=t=out:st=%.2f:d=0.08,", l, l - 0.08 }')
    ffmpeg -nostdin -v error -y -i "$src" -af "${cut}volume=${gain}dB,aformat=sample_rates=48000:channel_layouts=stereo" -c:a pcm_s16le "$out"
    count=$((count + 1))
  done
done <<< "$picks"

cat > "$dest/CREDITS.md" <<'EOF'
# Sound effects (CC0)

Fetched by `scripts/fetch-sfx.sh`. All CC0 1.0 (public domain): free for personal and commercial use, no
attribution required. Credit given gladly:

- Kenney (www.kenney.nl) — Interface Sounds, Impact Sounds, Sci-Fi Sounds: `pop/`, `hit/`, `click/`, `glitch/`
- artisticdude (opengameart.org) — Swishes Sound Pack: `whoosh/`
EOF
echo "$count sounds in $dest"
