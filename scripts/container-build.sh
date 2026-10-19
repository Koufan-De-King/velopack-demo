#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: ./scripts/container-build.sh 1.0.0}"

source "$HOME/.cargo/env" 2>/dev/null || true

flutter pub get
flutter build linux --release \
  --build-name "$VERSION" \
  --dart-define=APP_VERSION="$VERSION"

docker compose run --rm flutter-velopack \
  bash -lc "mkdir -p build/generated && \
    convert -background none assets/velopack-demo.svg -resize 256x256 build/generated/velopack-demo.png && \
    ./scripts/package-release.sh '$VERSION'"
