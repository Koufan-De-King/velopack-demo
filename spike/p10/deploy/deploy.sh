#!/usr/bin/env bash
# Reproducible P10 build + local deployment.
#   1. builds the JS and the Wasm web targets from the same source tree,
#   2. records that tree hash, 3. precompresses, 4. (re)starts nginx.
set -euo pipefail
DEPLOY="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DEPLOY/../../.." && pwd)"
cd "$REPO"

flutter --version | head -1
# Hash of the exact sources being built (committed or not, excluding spike/).
TREE=$(GIT_INDEX_FILE="$(mktemp)" bash -c 'git read-tree HEAD && git add -A -- . ":!spike" && git write-tree')
echo "source tree: $TREE (HEAD $(git rev-parse --short HEAD))"

rm -rf "$DEPLOY/www" && mkdir -p "$DEPLOY/www"
# --no-web-resources-cdn: serve the renderer (skwasm/canvaskit) from our own
# origin instead of www.gstatic.com, so COEP, caching and byte counts are
# under our control and the app has no hard dependency on Google's CDN.
flutter build web --release --no-web-resources-cdn
cp -R build/web "$DEPLOY/www/js"
flutter build web --release --wasm --no-web-resources-cdn
cp -R build/web "$DEPLOY/www/wasm"
echo "$TREE" | tee "$DEPLOY/www/js/SOURCE_TREE" > "$DEPLOY/www/wasm/SOURCE_TREE"

# Precompress for gzip_static (and .br for servers with ngx_brotli).
find "$DEPLOY/www" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.wasm' \
  -o -name '*.html' -o -name '*.json' -o -name '*.otf' -o -name 'NOTICES' \) \
  -exec gzip -9 -k -f {} \; -exec brotli -q 11 -k -f {} \;

[ -f "$DEPLOY/certs/localhost.crt" ] || "$DEPLOY/gen-cert.sh"
mkdir -p "$DEPLOY/logs"
cd "$DEPLOY"
if [ -f logs/nginx.pid ] && kill -0 "$(cat logs/nginx.pid)" 2>/dev/null; then
  nginx -p "$DEPLOY" -c nginx.conf -s reload
else
  nginx -p "$DEPLOY" -c nginx.conf
fi
echo "Wasm: https://localhost:8443/   JS: https://localhost:8444/"
