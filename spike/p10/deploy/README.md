# P10: reproducible Flutter Wasm build and deployment

Builds the JS and the Wasm web targets from the **same source tree** and serves
them behind HTTPS with the COOP/COEP headers that enable multithreaded
rendering (skwasm).

## Prerequisites

- Flutter ≥ 3.24 with web support (tested: Flutter 3.47.7 stable, Dart 3.13.5)
- nginx ≥ 1.25 (tested: 1.31.7, `brew install nginx`)
- `openssl`, `gzip`, `brotli`
- Google Chrome ≥ 119 (WasmGC) for the Wasm build (tested: Chrome 155)

The repository's `.devcontainer` only contains Velopack packaging tools, so
these must be installed on the host.

## One command

```bash
spike/p10/deploy/deploy.sh
```

It:

1. prints the Flutter version and the **git tree hash** of the sources being
   built (also written to `www/*/SOURCE_TREE`), so both builds provably come
   from the same revision, committed or not;
2. runs `flutter build web --release --no-web-resources-cdn` → `www/js`;
3. runs `flutter build web --release --wasm --no-web-resources-cdn` → `www/wasm`;
4. precompresses `.js/.mjs/.wasm/.json/.otf/.html` with gzip -9 and brotli -q 11;
5. creates a 13-day self-signed ECDSA certificate for `localhost` if missing;
6. starts (or reloads) nginx with `nginx.conf`.

| URL | Build | Headers |
|---|---|---|
| https://localhost:8443/ | Wasm | COOP `same-origin` + COEP `credentialless` (proposed) |
| https://localhost:8444/ | JS | same headers |
| https://localhost:8445/ | Wasm | none (single-threaded skwasm, for comparison) |
| https://localhost:8446/ | Wasm | COOP `same-origin` + COEP `require-corp` |

Stop with `nginx -p spike/p10/deploy -c nginx.conf -s stop`.

## The header configuration to reuse

[`flutter-web.conf`](flutter-web.conf) is the part to copy into a real server
block (`include flutter-web.conf;` inside `server { root …/build/web; }`):

```nginx
location / {
    try_files $uri $uri/ /index.html;

    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "credentialless" always;
    add_header Cache-Control "no-cache" always;
}
gzip_static on;
gzip_vary on;
```

- `application/wasm` is already in nginx's stock `mime.types` (≥ 1.21); on older
  nginx add `types { application/wasm wasm; }` as in the spike brief. `.mjs`
  must be served as `text/javascript` (added in `nginx.conf`).
- `Cache-Control: no-cache` is deliberate: Flutter output file names are not
  content-hashed, so browsers must revalidate (a warm load is ~2 KB of 304s).
- `--no-web-resources-cdn` matters: by default Flutter downloads the renderer
  (`skwasm`/`canvaskit`) from `www.gstatic.com`. Self-hosting keeps the app
  working without that third-party CDN and keeps COEP under our control.

## Verify

```bash
curl -skI https://localhost:8443/ | grep -i cross-origin
curl -skI -H 'Accept-Encoding: gzip' https://localhost:8443/main.dart.wasm | grep -i -E 'content-(type|encoding)'
cd spike/p10/bench && npm ci && node verify.mjs      # isolation, SAB, Wasm runtime, render worker
```

In Chrome DevTools (manual check):

- Console: `crossOriginIsolated` → `true`, `typeof SharedArrayBuffer` → `"function"`.
- The app's **Runtime** card reads *Web (WebAssembly / dart2wasm)*; the console
  logs `p10-runtime: Web (WebAssembly / dart2wasm)`. The JS fallback would say
  *dart2js*.
- Sources → Threads (or `Application → Frames`) shows a skwasm `blob:` worker:
  multithreaded rendering. Without the headers Flutter logs *"Skwasm will run
  in single-threaded mode"*.
- Network: `main.dart.wasm` and `canvaskit/skwasm.wasm` from our origin, no
  requests to `gstatic.com`.
