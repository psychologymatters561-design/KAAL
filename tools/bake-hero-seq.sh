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
#          (the master lives at incoming/film/kaal_commercial.mp4)
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

# ── The tiers. (October 2026: the film was re-cut as the master
#    incoming/film/kaal_commercial.mp4 — 1080x1920, 24fps, 409 frames,
#    17.04s, two hard cuts. Probe it before trusting any number below.)
#
#    `tall`        phones held upright. The film's OWN 9:16, uncropped,
#                  at 608x1080. The old tier was a 400x880 crop to a
#                  phone's ratio; the owner asked for the whole frame,
#                  and a 390px phone covers a 9:16 frame by losing a
#                  sixth of its width, which keeps the dial in every
#                  shot of this film. 608 is the film's width scaled by
#                  1080/1918 — two rows are trimmed so the scale is
#                  exact rather than a sub-pixel stretch.
#    `plate`       tablets and desktops. A 1080x1080 square at the film's
#                  native resolution — no upscale, ever. The landscape
#                  tier this replaces (1080x675) could not hold the dial:
#                  in the close-up the bezel is 36% of the film's height
#                  and a 1.6:1 crop of a 1080-wide film shows 35%, so on
#                  any 16:9 screen the bezel was cut top and bottom. The
#                  page now places this square as a plate beside the
#                  words instead of stretching a crop across the screen.
#    `plate-low`   the same square at 720x720, every second frame, for
#                  a tablet or desktop on a slow link. Phones on a slow
#                  link take every second frame of `tall` instead.
#
#    The crop is FIXED, never per frame: one rectangle for the whole
#    film, so the subject cannot drift between frames that the scrub
#    puts next to each other. The square's window is rows 286..1365 of
#    1920 — centred on y=0.43, the point that holds the close-up's
#    bezel (0.24-0.60), the desk dial (0.41-0.59) and the line-up
#    (0.40-0.59) all whole. Measured off frames 96, 150 and 300.
#
#    The counts are chosen for two properties, in this order.
#
#    n-1 must have whole divisors, because a fixed set of files can only
#    be sampled EVENLY at a whole-number stride and a stride divides n-1,
#    not n. 408 = 2*2*2*3*17, so a weak device can be handed 409, 205,
#    137, 103, 69 or 52 frames and every one of those is still evenly
#    spaced in time. Uneven spacing is not a smaller film, it is a film
#    that speeds up and slows down twice a second.
#
#    And then: as many as the film has. 409 is every frame the camera
#    recorded. Frames are the one thing the scrub cannot fake — a
#    dissolve between two frames far apart in time is a double exposure
#    rather than motion — and at native spacing there is nothing left to
#    dissolve across: neighbours are 42ms apart. (The history: 43, then
#    85 and 91, then the brief's 181 and 241, then all of them.)
#
#    The ceiling used to be decoded bitmap: every frame stayed decoded
#    for the life of the page, so the count was capped by memory. It is
#    not any more. The page holds ENCODED files for the whole film and
#    decodes only a window around the playhead, closing bitmaps that
#    leave it — see the sequence loader in index.html. Memory now caps
#    the window, not the film.
#
#    `tall-hd`     the phone tier at the film's own resolution, 1080x1918.
#                  Never scrubbed: a phone at 3x draws the 608 frame about
#                  2.3 times its size, which is soft. When the film comes to
#                  rest the page fetches this one file for the frame on
#                  screen and lays it over the canvas, and drops it the
#                  moment the scrub moves again. Every frame exists so the
#                  sharp picture is always the exact frame that was resting,
#                  never a neighbour. About 42KB each, one per pause.
#
#    name : width : height : frames : crop (ffmpeg filter, applied first)
TIERS="tall:608:1080:409:crop=1080:1918:0:1 tall-hd:1080:1918:409:crop=1080:1918:0:1 plate:1080:1080:409:crop=1080:1080:0:286 plate-low:720:720:205:crop=1080:1080:0:286"

# ONLY=tall-hd bakes one tier and leaves the others on disk untouched.
if [ -n "${ONLY:-}" ]; then
  TIERS=$(for T in $TIERS; do if [ "${T%%:*}" = "$ONLY" ]; then printf '%s ' "$T"; fi; done)
  [ -n "$TIERS" ] || { echo "no tier named $ONLY" >&2; exit 2; }
fi

# Quality.
#
# The 2026-10 sweep, 50 frames per tier against the lossless frame, PSNR
# over the dial's box (the one thing on the screen that is for sale):
#
#     Q    tall KB/frame  dial dB    plate KB/frame  dial dB
#     60        18.7       38.00          31.2        43.26
#     65        19.7       38.38          32.8        43.60
#     72        21.5       39.02          35.6        44.16
#     78        24.8       40.15          40.8        45.11
#
# 72 is the last step on the cheap part of the curve: 65 to 72 costs 9%
# more bytes for 0.6dB on the dial, 72 to 78 costs 15% for 1.1dB. The
# plate is at native resolution, which is why its dial holds 44dB where
# the scaled phone tier holds 39.
#
# (The first sweep, on the old 400x880 crop: 82 was the wrong point on
# the curve — 31% more bytes than 75 for the last seven points — and 65
# was where the tachymeter numerals still held. Kept for the record.)
Q=72

# ffmpeg with no output file reports the stream and exits non-zero, which is
# the cheapest probe there is and also why this one line is allowed to fail.
PROBE=$(ffmpeg -hide_banner -i "$SRC" 2>&1 || true)
DUR=$(printf '%s\n' "$PROBE" | sed -n 's/.*Duration: \([0-9:.]*\),.*/\1/p' \
      | awk -F: 'NR==1{printf "%.3f", $1*3600 + $2*60 + $3}')
FPS=$(printf '%s\n' "$PROBE" | sed -n 's/.*, \([0-9.]*\) fps.*/\1/p' | awk 'NR==1')
[ -z "${FPS:-}" ] && FPS=24
# The banner rounds the duration to centiseconds — 17.04 for a film that is
# 17.0417 — which moves the sampling rate by a hundredth of a percent. With
# round=near that still lands on every frame of this film, but on another
# it need not, so ffprobe's exact figure wins wherever ffprobe exists.
if command -v ffprobe >/dev/null 2>&1; then
  EXACT=$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$SRC" 2>/dev/null | awk 'NR==1')
  [ -n "${EXACT:-}" ] && [ "$EXACT" != "N/A" ] && DUR="$EXACT"
fi
[ -z "${DUR:-}" ] && { echo "could not read a duration from $SRC" >&2; exit 1; }

# The last frame STARTS one frame-time before the duration ends, so asking
# for 100% of the duration asks for a frame that is not there. SPAN is the
# distance from the first frame's start to the last frame's start: the
# stretch of film the sequence is spread evenly across.
SPAN=$(awk -v d="$DUR" -v f="$FPS" 'BEGIN{printf "%.6f", d - 1/f}')

echo "film: ${DUR}s at ${FPS}fps — sampling 0 to ${SPAN}s"

for T in $TIERS; do
  IFS=: read -r NAME W H N CROP <<EOF
$T
EOF
  mkdir -p "$OUT/$NAME"
  rm -f "$OUT/$NAME"/*.webp
  # n frames evenly across the span is n-1 intervals, so the sampling rate
  # is (n-1)/span. At 409 frames of a 24fps film that is exactly 24 — every
  # frame — and at 205 it is exactly 12, every second one. -vsync 0 hands
  # each sampled frame straight to its file, with no duplication or drop
  # by the muxer; the fps filter alone decides which frames those are.
  RATE=$(awk -v n="$N" -v s="$SPAN" 'BEGIN{printf "%.6f", (n-1)/s}')
  echo "── $NAME: $N frames at ${W}x${H}, ${RATE} per second of film"
  ffmpeg -hide_banner -loglevel error -i "$SRC" \
    -vf "fps=${RATE}:round=near,${CROP},scale=${W}:${H}:flags=lanczos" \
    -vsync 0 -frames:v "$N" -start_number 0 \
    -c:v libwebp -quality "$Q" -preset picture -compression_level 6 \
    -y "$OUT/$NAME/%03d.webp"
  GOT=$(ls "$OUT/$NAME" | wc -l)
  [ "$GOT" -eq "$N" ] || { echo "$NAME: wanted $N frames, got $GOT" >&2; exit 1; }
done

# ── The cuts.
#
#    This film has hard cuts in it, and a dissolve across a cut is not a
#    softer frame — it is two different rooms printed over each other. The
#    page blends neighbouring frames while the scrub moves, so it has to
#    know where the cuts are. They are found here, once, from the film
#    itself, as the index of the first SOURCE frame after each cut; the
#    page maps them onto whatever stride a tier or a device is using.
CUTS=$(ffmpeg -hide_banner -i "$SRC" -vf "select='gt(scene,0.3)',showinfo" -f null - 2>&1 \
  | sed -n 's/.*pts_time:\([0-9.]*\).*/\1/p' \
  | awk -v f="$FPS" '{printf "%s%d", (NR>1?", ":""), int($1*f + 0.5)}')

# ── The poster.
#
#    There is no separate still any more. The poster IS frame 000 of each
#    tier: the same file the canvas paints first, so the handover from the
#    picture to the film cannot move by a pixel or a shade. The page serves
#    it through a <picture> whose media queries are the same test the
#    script uses to pick a tier.
rm -f "$ROOT/assets/img/hero-still.webp"

echo
echo "── baked"
for T in $TIERS; do
  NAME="${T%%:*}"
  printf "%-10s %3d files  %6.2f MB\n" "$NAME" \
    "$(ls "$OUT/$NAME" | wc -l)" \
    "$(du -sb "$OUT/$NAME" | awk '{print $1/1e6}')"
done
echo
echo "── paste into the KAAL config in index.html if these moved:"
echo "  filmCuts: [${CUTS}],"
