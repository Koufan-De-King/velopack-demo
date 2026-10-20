# Spike P10: Flutter web with Wasm, COOP/COEP and WebTransport

| | |
|---|---|
| Backlog item | P10: *Flutter web with the wasm core: first-load size, COOP/COEP headers, WebTransport* → "Numbers and a header set" |
| Timebox | 2 days |
| Date | 2026-10-20 |
| Branch | `spike/p10-flutter-wasm-webtransport` (base `2bff0dc`, `Koufan-De-King/velopack-demo`) |
| Source tree built | `e80886327dae54aeb9540b41101a70beeee9f5df` (git tree hash, identical for the JS and Wasm builds) |

## 1. Question

Should the web version of the app ship as a **Flutter Wasm** build behind
**COOP/COEP** headers, and should real-time traffic use **WebTransport**
instead of (or in front of) **WebSocket**? What does it cost in size,
load time, compatibility and operations?

## 2. Recommendation (TL;DR)

1. **Ship the Wasm build (`flutter build web --wasm`) for S11, but serve it
   self-hosted (`--no-web-resources-cdn`) with COOP `same-origin` + COEP
   `credentialless`.** On Chromium it is never slower and is much smoother:
   first frame **−47 %** and TTI **−55 %** on desktop, TTI **−19 %** and
   main-thread blocking **−75 %** on a 4×-throttled phone over 4G, and it
   transfers **18 % fewer bytes**. Every other browser (Firefox, Safari,
   all of iOS) automatically gets the JS build from the same deployment, so
   there is no compatibility downside.
2. **Choose `credentialless` over `require-corp`.** Both enable
   multithreaded rendering, but `require-corp` blocked a normal third-party
   image (no CORP header) that `credentialless` loaded. Neither fixes the two
   real constraints of cross-origin isolation, which need product decisions
   in S11: **cross-origin iframes are blocked** (payment widgets, P12) and
   **popups lose `window.opener`** (popup-based login or payment, P6/P12). Use
   full-page redirects.
3. **WebTransport: not for the first release. Use WebSocket over TCP 443 as
   the primary real-time channel, with WebTransport as an S11+ optional
   upgrade behind feature detection** (decision in §10). WebTransport connects
   one RTT faster, copes better with packet loss and recovers faster from short outages (see §8), but it needs a
   QUIC-terminating server (nginx cannot proxy it), UDP 443 through every
   network hop, and a WebSocket fallback anyway (UDP-blocking networks; ~8 %
   of browsers).
4. **Keep the Rust core out of the web build for now.** `velopack` cannot
   compile to wasm32 (and makes no sense in a browser); `cratestack-client`
   **does** compile to wasm32, including a generated client. Exposing it to
   Dart through flutter_rust_bridge's web target is the S11 follow-up.

## 3. Test setup

| | |
|---|---|
| Machine | MacBook Pro, Intel Core i7-9750H (6 cores, 2.6 GHz), 32 GB, Intel UHD 630, macOS 15.8.1 |
| Flutter | 3.47.7 stable (engine `deb287481e`), Dart 3.13.5 |
| Browser (load tests) | Google Chrome 155.0.8059.85, driven by puppeteer-core 25.12.0 (headless, real GPU: *ANGLE Metal, Intel UHD 630*) |
| Browser (transport tests) | Chromium 155.0.8059.79 (Debian, headless) in Docker 29.2.1 |
| Web server | nginx 1.31.7, HTTP/2, TLS 1.3, self-signed ECDSA cert trusted by SPKI hash so HTTP caching behaves as with a real cert, `gzip_static` (gzip -9) |
| Transport server | Go 1.26, quic-go v0.62.0, webtransport-go v0.13.0, coder/websocket v1.8.15 |
| Rust | rustc 1.98.0, target `wasm32-unknown-unknown` |
| App | this repository's demo app (Material 3, one screen), with Velopack isolated to desktop (see §9.1) |

Not covered (needs other hardware or software): a physical low-end Android
phone, Firefox, Safari, Edge, a real Cameroonian mobile network (the profiles
below are emulated).

## 4. Build commands

From the repository root (also scripted in [`deploy/deploy.sh`](deploy/deploy.sh)):

```bash
flutter create . --platforms web            # once: adds web/
flutter build web --release --no-web-resources-cdn          # JS  → build/web
flutter build web --release --wasm --no-web-resources-cdn   # Wasm (+ JS fallback) → build/web
```

Build times on the test machine: ~30 s (JS) and ~32 s (Wasm). Both report the
same source tree hash. After the Velopack isolation, the Wasm dry-run that
`flutter build web` performs reports **"Wasm dry run succeeded"**.

## 5. Browser, device and network conditions

| Profile | CPU | Network (Chrome DevTools emulation) | Viewport |
|---|---|---|---|
| desktop, unthrottled | 1× | none (localhost) | 1280×800 |
| desktop, 4G | 1× | 150 ms RTT, 9 Mbit/s down, 1.5 Mbit/s up | 1280×800 |
| mobile 4× CPU, 4G | **4× slowdown** (low-end phone class) | 150 ms RTT, 9 / 1.5 Mbit/s | 412×915 @2.625, touch |
| mobile 4× CPU, slow 4G | 4× slowdown | 562.5 ms RTT, 1.44 / 0.675 Mbit/s (DevTools "Slow 4G") | 412×915 @2.625, touch |

- **Cold cache** = new browser context (empty HTTP cache). **Warm cache** = new
  tab in the same context right after the cold load.
- Each cell: **5 runs** (minimum required: 3). JS and Wasm runs are interleaved.
- `wasm-single-thread` = the same Wasm build served **without** COOP/COEP,
  to isolate the effect of multithreaded rendering.
- TTFB is ~2 ms in every row because the server is local; network emulation
  is applied after the first byte, so TTFB is not a meaningful comparison here.

## 6. JavaScript vs Wasm size

### Build output (KiB; gzip -9 / brotli -q 11)

| Item | JS raw | JS gzip | JS br | Wasm raw | Wasm gzip | Wasm br |
|---|---:|---:|---:|---:|---:|---:|
| app code (js) | 1,905 | 559 | 439 | 1,905 | 559 | 439 |
| app code (mjs) | - | - | - | 29 | 7 | 6 |
| app code (wasm) | - | - | - | 1,526 | 566 | 448 |
| bootstrap (index.html, flutter*.js, version.json) | 27 | 11 | 9 | 27 | 11 | 9 |
| debug symbols (not downloaded) | 8,380 | 1,171 | 786 | 8,380 | 1,171 | 786 |
| fonts | 176 | 92 | 77 | 176 | 92 | 77 |
| icons/manifest | 41 | 35 | 35 | 41 | 35 | 35 |
| other assets | 1,301 | 100 | 43 | 1,301 | 100 | 43 |
| renderer: canvaskit | 7,199 | 2,870 | 2,228 | 7,199 | 2,870 | 2,228 |
| renderer: chromium/ | 5,386 | 2,038 | 1,528 | 5,386 | 2,038 | 1,528 |
| renderer: skwasm | 3,572 | 1,518 | 1,196 | 3,572 | 1,518 | 1,196 |
| renderer: skwasm_heavy | 5,156 | 2,249 | 1,829 | 5,156 | 2,249 | 1,829 |
| renderer: webparagraph/ | 3,716 | 1,393 | 1,052 | 3,716 | 1,393 | 1,052 |
| renderer: wimp | 3,555 | 1,429 | 1,121 | 3,555 | 1,429 | 1,121 |
| **Total deployed** (excl. symbols) | 32,034 | 12,292 | 9,558 | 33,589 | 12,865 | 10,012 |

### Critical files actually downloaded by Chrome (KiB)

| Build | File | raw | gzip | br |
|---|---|---:|---:|---:|
| js | `main.dart.js` | 1,905 | 559 | 439 |
| js | `canvaskit/chromium/canvaskit.js` | 84 | 27 | 24 |
| js | `canvaskit/chromium/canvaskit.wasm` | 5,302 | 2,011 | 1,504 |
| js | **app + renderer** | **7,291** | **2,597** | **1,967** |
| wasm | `main.dart.mjs` | 29 | 7 | 6 |
| wasm | `main.dart.wasm` | 1,526 | 566 | 448 |
| wasm | `canvaskit/skwasm.js` | 62 | 17 | 15 |
| wasm | `canvaskit/skwasm.wasm` | 3,509 | 1,501 | 1,181 |
| wasm | **app + renderer** | **5,127** | **2,091** | **1,650** |

Notes:

- `flutter build` writes **every** renderer variant (~28 MiB raw) into
  `build/web`, but a browser downloads **one**: Chrome + Wasm build → `skwasm`,
  Chrome + JS build → `canvaskit/chromium`. Deploy all of them; only the
  "downloaded" table matters for users.
- The Wasm build also contains `main.dart.js`: it is the automatic fallback
  for browsers without WasmGC support (§9.4).
- `NOTICES` (1.3 MiB of licence text) is only fetched when the licence page
  opens; it compresses to 43 KiB with brotli.
- `--no-web-resources-cdn` bundles a 168 KiB Roboto fallback font
  (`assets/fonts/fallback/`). With the default CDN mode the renderer comes
  from `www.gstatic.com` and Roboto from `fonts.gstatic.com`, and their
  cross-origin `transferSize` is hidden from the page.
- Measured over the wire (CDP `encodedDataLength`, gzip, incl. headers):
  **JS 2,781 KiB / 9 requests, Wasm 2,274 KiB / 10 requests (−18 %)**.
  Brotli on the server would cut the critical files by another ~21 % (Wasm) to ~24 % (JS) (table above).

## 7. Loading benchmarks

### Loading benchmarks (Chrome/155.0.8059.85, 5 runs each; mean / worst, ms)

| Profile | Cache | Build | TTFB | First paint (FCP) | First Flutter frame | TTI | Total load | TBT | Longest task | Bytes (KiB) | Requests |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| desktop, unthrottled | cold | js | 2 / 2 | 536 / 557 | 451 / 472 | 532 / 552 | 532 / 552 | 159 / 170 | 153 / 156 | 2,781 | 9 |
| desktop, unthrottled | warm | js | 2 / 2 | 538 / 555 | 454 / 470 | 534 / 551 | 534 / 551 | 160 / 175 | 154 / 160 | 2 | 9 |
| desktop, unthrottled | cold | wasm | 2 / 2 | 344 / 349 | 238 / 241 | 238 / 241 | 238 / 241 | 0 / 0 | 0 / 0 | 2,274 | 10 |
| desktop, unthrottled | warm | wasm | 2 / 2 | 341 / 348 | 242 / 245 | 242 / 245 | 242 / 245 | 0 / 0 | 0 / 0 | 2 | 10 |
| desktop, unthrottled | cold | wasm-single-thread | 2 / 2 | 322 / 352 | 231 / 253 | 317 / 349 | 317 / 349 | 35 / 45 | 85 / 95 | 2,274 | 10 |
| desktop, unthrottled | warm | wasm-single-thread | 2 / 2 | 314 / 324 | 227 / 235 | 309 / 321 | 309 / 321 | 32 / 37 | 81 / 85 | 1 | 10 |
| desktop, 4G | cold | js | 2 / 2 | 3,347 / 3,354 | 3,261 / 3,265 | 3,343 / 3,350 | 3,343 / 3,350 | 177 / 190 | 130 / 136 | 2,781 | 9 |
| desktop, 4G | warm | js | 2 / 2 | 1,307 / 1,332 | 1,221 / 1,245 | 1,304 / 1,328 | 1,304 / 1,328 | 165 / 181 | 153 / 159 | 2 | 9 |
| desktop, 4G | cold | wasm | 2 / 2 | 3,298 / 3,311 | 3,031 / 3,045 | 3,032 / 3,046 | 3,032 / 3,046 | 2 / 6 | 41 / 54 | 2,274 | 10 |
| desktop, 4G | warm | wasm | 2 / 2 | 1,441 / 1,455 | 1,172 / 1,182 | 1,172 / 1,182 | 1,172 / 1,182 | 0 / 0 | 0 / 0 | 2 | 10 |
| desktop, 4G | cold | wasm-single-thread | 2 / 2 | 3,107 / 3,120 | 3,018 / 3,032 | 3,102 / 3,116 | 3,102 / 3,116 | 34 / 46 | 84 / 94 | 2,274 | 10 |
| desktop, 4G | warm | wasm-single-thread | 2 / 2 | 1,241 / 1,256 | 1,151 / 1,156 | 1,236 / 1,252 | 1,236 / 1,252 | 34 / 45 | 84 / 95 | 1 | 10 |
| mobile 4x CPU, 4G | cold | js | 1 / 2 | 4,314 / 4,330 | 3,992 / 4,006 | 4,312 / 4,328 | 4,312 / 4,328 | 1,472 / 1,505 | 537 / 555 | 2,781 | 9 |
| mobile 4x CPU, 4G | warm | js | 2 / 2 | 2,736 / 2,833 | 2,424 / 2,503 | 2,734 / 2,831 | 2,734 / 2,831 | 1,414 / 1,493 | 614 / 636 | 2 | 9 |
| mobile 4x CPU, 4G | cold | wasm | 2 / 2 | 3,810 / 3,833 | 3,505 / 3,525 | 3,507 / 3,528 | 3,507 / 3,528 | 367 / 382 | 208 / 217 | 2,274 | 10 |
| mobile 4x CPU, 4G | warm | wasm | 2 / 2 | 2,090 / 2,115 | 1,781 / 1,799 | 1,783 / 1,801 | 1,783 / 1,801 | 342 / 358 | 207 / 219 | 2 | 10 |
| mobile 4x CPU, 4G | cold | wasm-single-thread | 2 / 2 | 3,822 / 3,840 | 3,496 / 3,512 | 3,818 / 3,835 | 3,818 / 3,835 | 633 / 646 | 319 / 329 | 2,274 | 10 |
| mobile 4x CPU, 4G | warm | wasm-single-thread | 2 / 2 | 2,103 / 2,148 | 1,770 / 1,799 | 2,099 / 2,143 | 2,099 / 2,143 | 626 / 667 | 326 / 341 | 1 | 10 |
| mobile 4x CPU, slow 4G | cold | js | 2 / 2 | 18,898 / 19,027 | 18,576 / 18,667 | 18,896 / 19,026 | 18,896 / 19,026 | 1,535 / 1,680 | 562 / 586 | 2,781 | 9 |
| mobile 4x CPU, slow 4G | warm | js | 2 / 3 | 5,019 / 5,502 | 4,670 / 5,053 | 5,017 / 5,499 | 5,017 / 5,499 | 1,603 / 2,052 | 670 / 768 | 2 | 9 |
| mobile 4x CPU, slow 4G | cold | wasm | 2 / 2 | 17,200 / 17,259 | 16,471 / 16,507 | 16,473 / 16,510 | 16,473 / 16,510 | 391 / 425 | 220 / 232 | 2,274 | 10 |
| mobile 4x CPU, slow 4G | warm | wasm | 2 / 5 | 5,052 / 5,111 | 4,325 / 4,382 | 4,328 / 4,384 | 4,328 / 4,384 | 370 / 403 | 216 / 228 | 2 | 10 |
| mobile 4x CPU, slow 4G | cold | wasm-single-thread | 2 / 2 | 16,852 / 17,108 | 16,505 / 16,732 | 16,847 / 17,102 | 16,847 / 17,102 | 726 / 960 | 340 / 373 | 2,274 | 10 |
| mobile 4x CPU, slow 4G | warm | wasm-single-thread | 2 / 2 | 4,660 / 4,744 | 4,319 / 4,408 | 4,656 / 4,741 | 4,656 / 4,741 | 650 / 731 | 334 / 369 | 1 | 10 |

How to read it:

- **First Flutter frame** = the app's first post-frame callback
  (`performance.mark('flutter-first-frame')`); **FCP** = when Chrome painted it.
  **TTI** = first frame, or the end of the last long task after it once the
  main thread has been quiet for 2 s. **Total load** = max(network finished,
  TTI). **TBT** = sum of (long task − 50 ms) before TTI. **Longest task** is
  the jank indicator: anything over ~100 ms is a visible freeze.

Findings:

| Profile (cold) | First frame JS → Wasm | TTI JS → Wasm | TBT JS → Wasm |
|---|---|---|---|
| desktop, unthrottled | 451 → **238 ms (−47 %)** | 532 → **238 ms (−55 %)** | 159 → **0 ms** |
| desktop, 4G | 3,261 → **3,031 ms (−7 %)** | 3,343 → **3,032 ms (−9 %)** | 177 → **2 ms** |
| mobile 4×, 4G | 3,992 → **3,505 ms (−12 %)** | 4,312 → **3,507 ms (−19 %)** | 1,472 → **367 ms (−75 %)** |
| mobile 4×, slow 4G | 18,576 → **16,471 ms (−11 %)** | 18,896 → **16,473 ms (−13 %)** | 1,535 → **391 ms (−75 %)** |

- **Wasm never lost** a metric in any profile (worst cases included).
- Over the network, **bytes dominate**: Wasm is faster mostly because it
  downloads ~500 KiB less. On "slow 4G" both take 16–19 s cold, which is too
  slow for a first visit in our market whatever the compiler (follow-ups in §11).
- On a slow CPU the JS build freezes the main thread for **540–670 ms** at
  startup (visible jank); Wasm's worst task is ~220 ms.
- **Multithreading (COOP/COEP) matters for jank, not first frame**: without the
  headers first frame is the same, but TTI is +80 ms (desktop) / +310 ms
  (mobile) later and TBT doubles (633 vs 367 ms on mobile), because
  rasterisation then runs on the main thread.
- **Warm cache is still slow on mobile networks**: 1.2 s (4G) and 4.3–5.0 s
  (slow 4G) with only ~2 KB transferred. Flutter's file names are not
  content-hashed, so every file must be revalidated (304) at one round trip
  each. Fix in S11: content-hashed file names + `Cache-Control: immutable`
  or a service worker.

## 8. WebTransport vs WebSocket

### WebTransport vs WebSocket (Chrome/155.0.8059.79, 5 runs; mean / worst, ms)

| Condition | Transport | Connect | First message | RTT p50 | RTT p95 | Datagram RTT p50 (lost) | Small msgs/s (64 B) | Large Mbit/s (16 KiB) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| LAN (no shaping) | webtransport | 6.3 / 8.5 | 7.8 / 11.5 | 0.8 / 1.3 | 1.4 / 2.7 | 0.7 (0/500) | 435,841 | 651.8 |
| LAN (no shaping) | websocket | 4.1 / 4.9 | 5.1 / 6.1 | 0.7 / 0.8 | 1.0 / 1.5 | - | 8,099 | 498.6 |
| 4G: 150 ms RTT, 9/1.5 Mbit/s | webtransport | 330.2 / 333.5 | 483.6 / 487.4 | 153.9 / 154.1 | 155.3 / 155.6 | 153.7 (0/500) | 4,015 | 8.1 |
| 4G: 150 ms RTT, 9/1.5 Mbit/s | websocket | 482.5 / 501.2 | 636.6 / 654.6 | 153.9 / 154.0 | 154.6 / 155.2 | - | 2,638 | 8.2 |
| 4G + 1% loss each way | webtransport | 332.4 / 338.9 | 486.0 / 492.6 | 154.0 / 154.1 | 157.3 / 165.2 | 153.7 (14/500) | 3,649 | 2.5 |
| 4G + 1% loss each way | websocket | 478.2 / 479.4 | 631.9 / 634.1 | 153.9 / 154.0 | 154.7 / 155.0 | - | 981 | 2.7 |

### Temporary network loss (4G profile, 100% packet loss both ways, 2 runs each, fresh browser context per test; mean / worst)

| Client connect timeout | Outage | Transport | Transport noticed? | Detected after | Reconnect took | First msg after network back | Pings sent during outage delivered later | Lost pings |
|---|---:|---|---|---:|---:|---:|---:|---:|
| 3 s | 3 s | websocket | closed in 0/2 | - | - | 2.8 / 2.8 s | 62/62 | 3 |
| 3 s | 3 s | webtransport | closed in 0/2 | - | - | 0.4 / 0.4 s | 62/62 | 2 |
| 3 s | 15 s | websocket | closed in 0/2 | - | - | 8.4 / 8.6 s | 302/302 | 3 |
| 3 s | 15 s | webtransport | closed in 2/2 | 6.8 / 6.8 s | 8.9 / 8.9 s | 0.8 / 0.8 s | 0/136 | 142 |
| 3 s | 45 s | websocket | closed in 0/2 | - | - | 1.5 / 1.7 s | 902/902 | 4 |
| 3 s | 45 s | webtransport | closed in 2/2 | 6.8 / 6.8 s | 43.2 / 45.9 s | 5.1 / 7.8 s | 0/136 | 142 |
| 10 s | 3 s | websocket | closed in 0/2 | - | - | 2.8 / 2.8 s | 62/62 | 2 |
| 10 s | 3 s | webtransport | closed in 0/2 | - | - | 0.4 / 0.4 s | 62/62 | 3 |
| 10 s | 15 s | websocket | closed in 0/2 | - | - | 8.4 / 8.4 s | 302/302 | 3 |
| 10 s | 15 s | webtransport | closed in 2/2 | 6.8 / 6.8 s | 8.7 / 8.7 s | 0.6 / 0.6 s | 0/136 | 144 |
| 10 s | 45 s | websocket | closed in 0/2 | - | - | 1.5 / 1.5 s | 902/902 | 2 |
| 10 s | 45 s | webtransport | closed in 2/2 | 6.8 / 6.8 s | 39.0 / 39.2 s | 0.9 / 1.0 s | 0/136 | 143 |
| none | 3 s | websocket | closed in 0/2 | - | - | 2.8 / 2.8 s | 62/62 | 3 |
| none | 3 s | webtransport | closed in 0/2 | - | - | 0.4 / 0.4 s | 62/62 | 2 |
| none | 15 s | websocket | closed in 0/2 | - | - | 8.5 / 8.6 s | 302/302 | 4 |
| none | 15 s | webtransport | closed in 2/2 | 6.8 / 6.8 s | 8.7 / 8.7 s | 0.6 / 0.6 s | 0/136 | 144 |
| none | 45 s | websocket | closed in 0/2 | - | - | 1.6 / 1.7 s | 902/902 | 3 |
| none | 45 s | webtransport | closed in 2/2 | 6.8 / 6.8 s | 41.6 / 44.0 s | 3.6 / 5.9 s | 0/136 | 144 |

"Lost pings" for WebSocket (2–4) are the last pings still in flight when the
probe stopped. The first outage run, in which all tests shared one browser
and so accumulated failures against the same server, is kept in
`results/transport.json` (`outages`).

Setup: [`transport/README.md`](transport/README.md). Headless Chromium and the
Go server run in two Docker containers, with latency and loss applied to real
packets with `tc netem` (port 9443 only, both directions). Small-message
throughput compares one WebSocket message per frame with a WebTransport
stream carrying length-prefixed frames. That is how each would really be used,
but part of WebTransport's LAN advantage is fewer JS events, not the network.

Findings:

- **Connection setup: WebTransport saves one round trip.** 330 ms vs 482 ms on
  4G (QUIC merges the transport and TLS handshakes: 2 RTT vs 3 RTT for
  TCP + TLS 1.3 + HTTP Upgrade). The first message arrives 150 ms sooner.
- **Latency on an open connection: identical** (154 ms p50 on a 150 ms link).
  WebTransport adds nothing and removes nothing once connected.
- **Under packet loss WebTransport keeps small messages flowing**: 3,649 vs
  981 msg/s at 1 % loss (3.7×). One lost TCP segment stalls everything behind
  it (head-of-line blocking). Bulk throughput is the same for both
  (link-limited). Datagrams are unreliable by design: 14 of 500 lost at 1 %.
- **Outages: each transport fails differently, and neither is enough alone.**
  - WebSocket/TCP **never noticed** any outage (up to 45 s). The connection
    stays up and every queued message arrives late, after TCP's retransmission
    backoff: **2.8 s** after a 3 s outage and **8.4 s** after a 15 s outage
    before traffic flows again. The app cannot tell a dead link from a quiet
    one, so an **application heartbeat is mandatory**.
  - Chromium **closes a WebTransport session after ~6.8 s** of silence. Short
    outages (3 s) are survived and recover in **0.4 s**. Longer ones need a
    reconnect, which then succeeds within **0.6–1 s** of the network returning
    in most runs (worst 7.8 s). Everything in flight on the dropped
    session is **lost** (0 of 136 pings delivered), so session resume and
    replay must be built.
  - **Chromium throttles WebTransport handshakes after failures**
    (`content/browser/webtransport/web_transport_throttle_context.cc`): a
    failed handshake to a server IP adds a delay of up to **5 minutes**,
    remembered for **15 minutes**, and a handshake the page cancels counts as
    a failure. In the first outage run all tests shared one browser, so
    failures accumulated: WebTransport then took 14–24 s to come back after a
    15 s outage and **did not recover within 2 minutes after a 45 s outage**,
    while WebSocket on the same network resumed in ~2 s. A user on a flaky
    connection (repeated drops) hits exactly this. A client must stop
    retrying WebTransport after a couple of failures and carry on over
    WebSocket.
  - The client connect timeout (3 s, 10 s, none) changed little in isolated
    tests.

## 9. Compatibility issues

### 9.1 App code: Velopack/Rust FFI broke the web build at runtime

Both web builds **compiled** with the original code, but the page stayed
**blank**: `main()` awaits `initializeVelopack()`, and on the web
flutter_rust_bridge tries to load `pkg/velopack_flutter.js` (a wasm-bindgen
build of the Rust crate, which does not exist). It gets a 404 and `main()`
never returns. `dart:io` (`exit`, `Process`, `Platform.environment`) is also
used. Fixed on this branch by moving all Velopack and `dart:io` code behind a
conditional import:

```
lib/platform/platform.dart      export 'platform_io.dart' if (dart.library.js_interop) 'platform_web.dart';
lib/platform/platform_io.dart   Velopack, dart:io (desktop, unchanged behaviour)
lib/platform/platform_web.dart  updates disabled, Runtime label, first-frame mark
```

After the change the Wasm dry-run passes, `flutter analyze` and `flutter test`
pass, and the app shows a **Runtime** card reading *Web (WebAssembly /
dart2wasm)* or *Web (JavaScript / dart2js)*.

### 9.2 Packages

| Package | Wasm status |
|---|---|
| `velopack_flutter` 0.2.0 | Native only (dart:ffi + Rust). Must not be imported on web. |
| `flutter_rust_bridge` 2.11.1 (transitive) | dart2wasm lint `invalid_runtime_check_with_js_interop_types` in `lib/src/platform_utils/_web.dart:44`. Warning, not an error, but any FRB-on-web plan must be tested at runtime with dart2wasm. FRB web also needs `SharedArrayBuffer`, so the COOP/COEP headers are needed for it too. |
| Flutter SDK (`material`, `cupertino_icons` not used) | OK |

No `dart:html`, `package:js` or `dart:js` use in the app.

### 9.3 Rust core and `cratestack-client` → wasm32

Full details and how to rerun: [`rust-wasm-check/README.md`](rust-wasm-check/README.md).

| Crate | wasm32-unknown-unknown |
|---|---|
| `velopack` 1.2.161 | ❌ `ring` 0.17 C build (Apple clang has no wasm32 target), `getrandom` 0.2 without `js` feature, and conceptually desktop-only |
| `cratestack-client` 0.15.4 (default, `cose`, `middleware`) | ✅ |
| client generated by `include_client_schema!` (cdylib) | ✅ 753 KiB release before `wasm-opt`, only wasm-bindgen imports |

### 9.4 Browser limitations

- **Flutter Wasm runs only in Chromium-based browsers** (WasmGC, Chrome ≥ 119).
  Firefox (WasmGC since 120) and Safari currently hit bugs that block
  Flutter's Wasm renderer, and every iOS browser is WebKit. All of these
  **automatically load the JS build** from the same deployment (`flutter_bootstrap.js`
  detects WasmGC). Verified: the Wasm deployment in Chrome loads
  `main.dart.wasm` and `skwasm`, never `main.dart.js` (`results/verify.json`).
  Firefox, Safari and iOS were not tested on a device in this spike.
- **COEP `credentialless` is not supported by Safari** (any version; caniuse).
  Today this costs nothing, because Safari runs the single-threaded JS build anyway.
  If Safari ever runs Flutter Wasm, `require-corp` would be needed for
  multithreading there.
- **Cross-origin isolation side-effects** (measured, `results/coep-assets.json`):

| Third-party resource | no headers | COEP `credentialless` | COEP `require-corp` |
|---|---|---|---|
| `<img>`, host without CORP header (Wikimedia) | ✅ | ✅ | ❌ blocked |
| `<img crossorigin>` / `fetch` CORS (same host) | ✅ | ✅ | ✅ |
| `<img>`, host with `CORP: cross-origin` (GitHub avatar) | ✅ | ✅ | ✅ |
| Web font from fonts.gstatic.com | ✅ | ✅ | ✅ |
| Cross-origin `<iframe>` whose page has no COEP (example.com) | ✅ | ❌ blocked | ❌ blocked |
| `window.open` popup to another origin | handle works | ❌ handle reports `closed` | ❌ handle reports `closed` |

## 10. Fallback decision

**Decision: WebSocket is the baseline. WebTransport is optional and falls back
to WebSocket. No HTTP polling.**

| Option | Verdict |
|---|---|
| WebTransport → WebSocket | **Chosen** for when WebTransport is adopted (S11+): feature-detect `WebTransport`, try it with a **~3 s connect timeout** (UDP may be blocked silently), and fall back to WebSocket on timeout, error or a missing API. After a WebTransport failure or drop, **reconnect on WebSocket** and retry WebTransport only after several minutes: Chromium penalises repeated failed WebTransport handshakes to the same server IP for up to 5 min (measured in §8). |
| WebTransport → HTTP/2 or HTTPS polling | Rejected: WebSocket works everywhere WebTransport is missing (~99 % of browsers, TCP 443 is never blocked) with far better latency than polling. Polling adds a third code path for no gain. |
| No fallback for the first release | Rejected for WebTransport-only: it would cut off ~8 % of browsers and every user behind a UDP-blocking network. Accepted in the sense that **release 1 uses WebSocket only**. |

Browser support (caniuse, Oct 2026): WebTransport Chrome 97, Edge 98,
Firefox 114, Safari/iOS **26.4**, Samsung Internet 18, ~91.6 % global.
WebSocket: all browsers.

Operational complexity of adding WebTransport:

- a QUIC/HTTP/3 server with the WebTransport extension in the backend (Rust:
  `wtransport`, or `h3` + `h3-webtransport` on `quinn`); **nginx cannot proxy
  WebTransport**, so the service terminates it itself or sits behind a UDP/QUIC
  passthrough load balancer;
- UDP 443 open on every hop, monitoring of UDP reachability and handshake
  failures, and a second transport to test, scale and debug (HTTP/3 tooling
  is weaker than WebSocket's);
- a publicly trusted certificate (the `serverCertificateHashes` shortcut used
  here is development-only);
- the WebSocket path must exist anyway, so WebTransport is pure extra.

## 11. Follow-up work for S11

1. **Adopt the Wasm build in the real app**: `--wasm --no-web-resources-cdn`, COOP
   `same-origin` + COEP `credentialless`, and keep `lib/platform/*` (or a
   similar conditional-import split) for every native plugin.
2. **First-load size budget for slow 4G** (16–19 s cold today): content-hashed
   asset names + `immutable` caching, Brotli at the edge (−21–24 % on the critical files), and
   deferred loading (`--enable-wasm-deferred-loading`, experimental until
   Flutter 3.50); check whether `skwasm_heavy` or `wimp` is the right
   renderer variant for us; measure the real app, not this one-screen demo.
3. **Login and payment flows under COOP/COEP** (with P6 and P12): replace
   popups and iframes with full-page redirects, or isolate them on a separate
   non-isolated origin. Confirm NotchPay's web checkout works with redirects.
4. **Rust core on the web**: build `cratestack-client` through flutter_rust_bridge's
   web target (`flutter_rust_bridge_codegen build-web`), call it from dart2wasm,
   prove the FRB lint is harmless at runtime, measure `.wasm` size after
   `wasm-opt -Oz`. Pin rustc ≥ 1.98 in CI.
5. **Real-time channel**: build the production WebSocket path with an
   application heartbeat (≤ 10 s; TCP alone never noticed a 45 s outage) and
   resumable sessions (sequence numbers + replay), because the transport
   alone loses messages on reconnect. Prototype WebTransport behind the
   fallback only if P11 (QUIC on Cameroonian networks) shows a clear win. Share
   the HTTP/3 server work with P11.
6. **Test on real devices and browsers**: a low-end Android phone on an MTN or
   Orange connection, Firefox and Safari (JS fallback path, `credentialless`
   ignored), iOS.

## 12. Deliverables in this branch

| Deliverable | Where |
|---|---|
| Spike report | this file |
| Working HTTP response-header configuration | [`deploy/flutter-web.conf`](deploy/flutter-web.conf), [`deploy/nginx.conf`](deploy/nginx.conf), verified in `results/curl-headers.txt` |
| Reproducible Wasm build + deployment procedure | [`deploy/README.md`](deploy/README.md), [`deploy/deploy.sh`](deploy/deploy.sh) |
| WebTransport prototype + fallback result | [`transport/`](transport/) (server, client, Docker benchmark, README), §8 and §10 |
| Rust / `cratestack-client` → Wasm blockers | [`rust-wasm-check/README.md`](rust-wasm-check/README.md) |
| Benchmark scripts | [`bench/`](bench/) (load benchmarks, isolation checks, COEP asset matrix), [`scripts/`](scripts/) (sizes, tables) |
| Raw results | [`results/`](results/) (`sizes.json`, `bench.json`, `verify.json`, `coep-assets.json`, `transport.json`, screenshots) |

## Definition of done

| Criterion | Status |
|---|---|
| JS and Wasm builds from the same source revision | ✅ tree `e808863…` for both |
| Total initial payload and loading timings recorded | ✅ §6, §7 (4 profiles × cold/warm × 5 runs) |
| Wasm build verified in a supported browser | ✅ Chrome 155: `main.dart.wasm` + skwasm, runtime label *dart2wasm* |
| COOP/COEP headers deployed and validated | ✅ `curl -I` + `crossOriginIsolated === true`, `SharedArrayBuffer` available |
| Multithreaded rendering tested | ✅ skwasm render worker present with headers, absent without; timings in §7 |
| WebTransport compared with WebSocket using measured results | ✅ §8 |
| Fallback decision documented | ✅ §10 |
| Clear recommendation for S11 | ✅ §2 |
