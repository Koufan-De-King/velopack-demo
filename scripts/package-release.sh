#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: ./scripts/package-release.sh 1.0.0}"

vpk pack \
  --packId com.example.velopackdemo \
  --packVersion "$VERSION" \
  --packDir build/linux/x64/release/bundle \
  --mainExe velopack_demo \
  --icon build/generated/velopack-demo.png \
  --categories Utility \
  --packTitle "Velopack Flutter Demo" \
  --outputDir Releases

echo "Created Linux AppImage release for $VERSION in Releases/."
