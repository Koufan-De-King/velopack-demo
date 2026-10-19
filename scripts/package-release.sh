#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: ./scripts/package-release.sh 1.0.0}"
OUTPUT_DIR="${VPK_OUTPUT_DIR:-Releases}"
DELTA_MODE="${VPK_DELTA_MODE:-BestSpeed}"

PACK_ARGS=(
  --packId com.example.velopackdemo
  --packVersion "$VERSION"
  --packDir build/linux/x64/release/bundle
  --mainExe velopack_demo
  --icon build/generated/velopack-demo.png
  --categories Utility
  --packTitle "Velopack Flutter Demo"
  --delta "$DELTA_MODE"
  --outputDir "$OUTPUT_DIR"
)

if [[ -n "${VELOPACK_AZURE_TRUSTED_SIGN_FILE:-}" ]]; then
  PACK_ARGS+=(--azureTrustedSignFile "$VELOPACK_AZURE_TRUSTED_SIGN_FILE")
fi

vpk pack "${PACK_ARGS[@]}"

echo "Created Linux AppImage release for $VERSION in $OUTPUT_DIR/."
