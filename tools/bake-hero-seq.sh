#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  Bake the hero sequence.
#
#  This is NOT a build step. It is run by hand, once, when the film
#  changes — and its output is committed. The site still has no build
#  step, no npm and no bundler: it has a directory of pictures that a
#  person put there, exactly like the eight photographs.
#
#  Why this exists at all: the hero used to ask Cloudinary for each
#  still at scroll time, through a transform template that encoded a
#  timestamp AND the viewport's own width and height. Every distinct
#  (time, width, height) triple is a live video seek plus a transcode
#  on someone else's server before a single byte comes back. The first
#  visitor at any given phone width paid for that cold start, in the
#  one place on the page that cannot afford to wait. Baking the frames
#  turns that into a file read from the same origin as the page.
#
#  Usage:  tools/bake-hero-seq.sh path/to/film.mp4
#
#  Needs ffmpeg with libwebp, which every ffmpeg build since 4.x has.
#  Nothing here is installed into the repo and nothing here ships.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "usage: tools/bake-hero-seq.sh path/to/film.mp4" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/img/hero-seq"

# ── The tiers.
#
#    Two, not a continuum. The old code rounded the viewport to the
#    nearest eighty pixels and asked for exactly that, which against a
#    transcoding backend meant almost every device width was its own
#    cold start. Against static files the trade is the opposite way
#    round: a file that many devices share is a file already in the
#    CDN's edge cache, and the canvas covers whatever is left over.
#
#    `tall`  portrait viewports. 400x880 is the phone canvas this page
#            has always drawn, at the ratio 0.455 that sits between a
#            360x740 Android and a 430x932 iPhone, so neither crops far.
#    `wide`  landscape viewports. 1080 wide because the film IS 1080
#            wide — asking for 1240 only ever bought an upscale, paid
#            for in bytes. 675 puts it at 1.6:1, between a 16:10 laptop
#            and a 16:9 monitor.
#
#    The counts are chosen for two properties, in this order.
#
#    n-1 must have whole divisors, because a fixed set of files can only
#    be sampled EVENLY at a whole-number stride and a stride divides n-1,
#    not n. 84 divides by 2, 3, 4, 6, 7 and 12; 90 by 2, 3, 5, 6, 9 and
#    10. So every reduced sequence a weak device is handed is still
#    evenly spaced in time. Uneven spacing is not a smaller film, it is a
#    film that speeds up and slows down twice a second.
#
#    And then: as many as the memory will hold. 85 and 91 replace 43 and
#    61 because frames are the one thing the scrub cannot fake — blending
#    turns a stepped sequence into a continuous one, but a dissolve
#    between two frames far apart in time is a double exposure rather
#    than motion, and the only fix for that is neighbours that are closer
#    together. 85 frames of a 17-second film is one every 200ms of it.
#
#    The ceiling is decoded bitmap, not file size: a tall frame is
#    400*880*4 = 1.41MB the moment it is painted and stays that way for
#    the life of the page. 85 of them is 120MB, 91 wide ones is 265MB.
#    Both are inside what frameWant() will hand out, and frameWant() is
#    what decides how many of these a given device actually takes.
TIERS="tall:400:880:85 wide:1080:675:91"

# Quality. Measured, not guessed: at 82 a tall frame lands at ~19KB and a
# wide one at ~38KB. At the counts above that is 1.64MB for a phone and
# 3.49MB for a laptop — the phone figure roughly doubled when the frame
# count did, which is the honest cost of the smoothness and the reason
# frameWant() and the Save-Data gate both still matter. There is room to
# go higher on quality; there is no visible reason to, and every byte
# here is paid on cellular before anything moves.
Q=82

# ffmpeg with no output file reports the stream and exits non-zero, which is
# the cheapest probe there is and also why this one line is allowed to fail.
PROBE=$(ffmpeg -hide_banner -i "$SRC" 2>&1 || true)
DUR=$(printf '%s\n' "$PROBE" | sed -n 's/.*Duration: \([0-9:.]*\),.*/\1/p' \
      | awk -F: 'NR==1{printf "%.3f", $1*3600 + $2*60 + $3}')
FPS=$(printf '%s\n' "$PROBE" | sed -n 's/.*, \([0-9.]*\) fps.*/\1/p' | awk 'NR==1')
[ -z "${FPS:-}" ] && FPS=24
[ -z "${DUR:-}" ] && { echo "could not read a duration from $SRC" >&2; exit 1; }

# The last frame STARTS one frame-time before the duration ends, so asking
# for 100% of the duration asks for a frame that is not there.
LAST=$(awk -v d="$DUR" -v f="$FPS" 'BEGIN{printf "%.4f", d - 1/f}')

echo "film: ${DUR}s at ${FPS}fps — sampling 0 to ${LAST}s"

for T in $TIERS; do
  IFS=: read -r NAME W H N <<EOF
$T
EOF
  mkdir -p "$OUT/$NAME"
  rm -f "$OUT/$NAME"/*.webp
  echo "── $NAME: $N frames at ${W}x${H}"

  i=0
  while [ "$i" -lt "$N" ]; do
    TS=$(awk -v i="$i" -v n="$N" -v l="$LAST" 'BEGIN{printf "%.4f", (i/(n-1))*l}')
    IDX=$(printf "%03d" "$i")
    # crop to the tier's ratio from the centre — the same frame Cloudinary's
    # c_fill,g_center was returning — then scale once, with a real filter.
    ffmpeg -hide_banner -loglevel error -ss "$TS" -i "$SRC" -frames:v 1 \
      -vf "crop='min(iw,ih*$W/$H)':'min(ih,iw*$H/$W)',scale=$W:$H:flags=lanczos" \
      -c:v libwebp -quality "$Q" -preset picture -compression_level 6 \
      -y "$OUT/$NAME/$IDX.webp"
    i=$((i + 1))
  done
done

# ── The still.
#
#    The one frame the page shows when the film is not running: reduced
#    motion, a viewport under 340px, a device too small to hold the
#    sequence, or every frame failing. It was the last thing in the hero
#    still reaching for Cloudinary, and it was reaching for it on every
#    single load, because the file it names has never existed in the repo.
#    It is the largest image above the fold, so that request was on the
#    critical path to the largest paint.
#
#    Portrait at the film's own size, because the still has to work under
#    object-fit:cover in both orientations and only portrait keeps the
#    whole subject.
STILL_AT=$(awk -v l="$LAST" 'BEGIN{printf "%.3f", l*0.353}')
ffmpeg -hide_banner -loglevel error -ss "$STILL_AT" -i "$SRC" -frames:v 1 \
  -vf "scale=1080:1920:flags=lanczos" \
  -c:v libwebp -quality 80 -preset picture -compression_level 6 \
  -y "$ROOT/assets/img/hero-still.webp"

echo
echo "── baked"
for T in $TIERS; do
  NAME="${T%%:*}"
  printf "%-6s %3d files  %6.2f MB\n" "$NAME" \
    "$(ls "$OUT/$NAME" | wc -l)" \
    "$(du -sb "$OUT/$NAME" | awk '{print $1/1e6}')"
done
printf "%-6s %3d file   %6.2f MB\n" "still" 1 \
  "$(stat -c%s "$ROOT/assets/img/hero-still.webp" | awk '{print $1/1e6}')"
