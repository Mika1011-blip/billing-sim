#!/usr/bin/env bash
# Places the nine narration files (voice/narration-fr-0N.mp3) at the scene start times recorded in timeline.json
# over demo.webm, and writes demo.mp4 (H.264 + AAC). Runs ffmpeg in Docker; no local install needed.
#   bash docs/demo/mux.sh            (from the repo root)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
WIN="$(cygpath -w "$DIR" 2>/dev/null || echo "$DIR")"
IMG=jrottenberg/ffmpeg:6.1-alpine

# scene start times → ms offsets (python is only used to read the JSON)
mapfile -t STARTS < <(python -I -c "import json,sys; d=json.load(open(sys.argv[1])); print('\n'.join(str(int(s['start']*1000)) for s in d['scenes']))" "$DIR/timeline.json")
[ "${#STARTS[@]}" -eq 9 ] || { echo "expected 9 scenes in timeline.json, got ${#STARTS[@]}"; exit 1; }

INPUTS=(-i /work/demo.webm)
FILTER=""
MIX=""
for i in $(seq 1 9); do
  INPUTS+=(-i "/work/voice/narration-fr-0$i.mp3")
  ms=${STARTS[$((i-1))]}
  FILTER+="[$i:a]aresample=48000,adelay=${ms}|${ms}[a$i];"
  MIX+="[a$i]"
done
FILTER+="${MIX}amix=inputs=9:normalize=0:dropout_transition=0[aout]"

MSYS_NO_PATHCONV=1 docker run --rm -v "$WIN:/work" "$IMG" -y -loglevel error \
  "${INPUTS[@]}" -filter_complex "$FILTER" -map 0:v -map "[aout]" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -shortest -movflags +faststart \
  /work/demo.mp4
echo "wrote $DIR/demo.mp4"
MSYS_NO_PATHCONV=1 docker run --rm -v "$WIN:/work" --entrypoint ffprobe "$IMG" -v error -show_entries format=duration -of csv=p=0 /work/demo.mp4
