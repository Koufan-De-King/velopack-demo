# P10 briefing: what to say

Spike P10: Flutter web with Wasm, COOP/COEP headers, WebTransport.
Branch `spike/p10-flutter-wasm-webtransport` on `Marc-Jr/velopack-demo`.
Full details: [`REPORT.md`](REPORT.md).

## The 30-second answer

> "Yes to Wasm, with the COOP/COEP headers, `credentialless`. It is faster
> and smoother on Chrome and costs nothing elsewhere, because other browsers
> automatically get the JS build. No to WebTransport for release 1: WebSocket
> stays the main channel, and WebTransport can come later as an optional
> upgrade that falls back to WebSocket. The Rust core stays off the web
> for now, but `cratestack-client` does compile to Wasm."

## What I did

1. Added web support to the demo app and found that it **built but showed a
   blank page**: Velopack (Rust) cannot load in a browser. I fixed it by making
   Velopack desktop-only (`lib/platform/`).
2. Built **JS and Wasm from the same source** and measured their sizes.
3. Ran **loading benchmarks**: 4 profiles × cold/warm cache × 5 runs, JS vs Wasm.
4. Deployed behind **nginx with HTTPS + COOP/COEP** and verified isolation,
   `SharedArrayBuffer` and multithreaded rendering in Chrome.
5. Checked whether **Velopack and `cratestack-client` compile to Wasm**.
6. Built a **WebTransport vs WebSocket prototype** (Go server + browser client)
   and measured it on real delayed and dropped packets in Docker.
7. Wrote the **fallback decision** and the **S11 follow-ups**.

## Key numbers

### Size (what Chrome downloads, gzip)

| | JS build | Wasm build |
|---|---:|---:|
| Downloaded over the wire | 2,781 KiB | **2,274 KiB (−18 %)** |
| App code + renderer | 2,597 KiB | **2,091 KiB** |
| Requests | 9 | 10 |

Brotli instead of gzip would save another ~21–24 %.

### Loading speed (cold cache, average of 5 runs)

| Profile | First frame JS → Wasm | Ready to use (TTI) JS → Wasm | Main thread blocked JS → Wasm |
|---|---|---|---|
| Desktop | 451 → **238 ms** (−47 %) | 532 → **238 ms** (−55 %) | 159 → **0 ms** |
| Desktop, 4G | 3,261 → **3,031 ms** | 3,343 → **3,032 ms** | 177 → **2 ms** |
| Slow phone (4× CPU), 4G | 3,992 → **3,505 ms** | 4,312 → **3,507 ms** (−19 %) | 1,472 → **367 ms** (−75 %) |
| Slow phone, slow 4G | 18,576 → **16,471 ms** | 18,896 → **16,473 ms** | 1,535 → **391 ms** |

- **Wasm never lost** a single metric.
- Main-thread freezes on a slow phone: JS **540–670 ms**, Wasm **~220 ms**.
- Without the headers (single-threaded) Wasm is still fine, but jank about **doubles**.
- ⚠️ Slow 4G first visit takes **16–19 s** for both builds, which is too slow. S11 work.
- ⚠️ Even with a warm cache, mobile networks need **1.2–5 s**, because every file is
  revalidated. Fix: hashed file names + long-term caching.

### WebTransport vs WebSocket (4G: 150 ms RTT)

| | WebTransport | WebSocket |
|---|---:|---:|
| Connect | **330 ms** (2 round trips) | 482 ms (3 round trips) |
| First message | **484 ms** | 637 ms |
| Round trip on an open connection | 154 ms | 154 ms (same) |
| Small messages/s with 1 % packet loss | **3,649** | 981 |
| Bulk throughput | same | same |

**Network cut (all packets dropped):**

| Outage | WebTransport | WebSocket |
|---|---|---|
| 3 s | survives, back in **0.4 s** | survives, back in 2.8 s |
| 15 s | session dropped after ~7 s, reconnects **~0.7 s** after network returns, in-flight messages **lost** | never notices, messages arrive **8.4 s** late, none lost |
| 45 s | reconnects ~1–8 s after network returns, messages lost | never notices, back in 1.5 s, none lost |
| Repeated failures | **Chrome blocks new attempts up to 5 min** (stuck > 2 min in my test) | unaffected |

## The header set (the deliverable)

```nginx
location / {
    try_files $uri $uri/ /index.html;

    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "credentialless" always;
    add_header Cache-Control "no-cache" always;
}

gzip_static on;
gzip_vary on;
# .wasm → application/wasm (already in nginx mime.types ≥ 1.21)
# .mjs  → text/javascript
```

Build command:

```bash
flutter build web --release --wasm --no-web-resources-cdn
```

`--no-web-resources-cdn` matters: without it, Flutter loads its renderer from
Google's CDN (`gstatic.com`) instead of our server.

Verified with `curl -I` and in Chrome: `crossOriginIsolated = true`,
`SharedArrayBuffer` available, render worker running, runtime = dart2wasm.

### Why `credentialless` and not `require-corp`

| | credentialless | require-corp |
|---|---|---|
| Multithreaded rendering | ✅ | ✅ |
| Third-party image without CORP header | ✅ loads | ❌ blocked |
| Cross-origin iframe (payment widget) | ❌ blocked | ❌ blocked |
| Popup login/payment (`window.opener`) | ❌ link cut | ❌ link cut |
| Safari support | ❌ (doesn't matter: Safari runs JS) | ✅ |

👉 **Important for P6/P12:** with either option, **popups and iframes break**,
so login and payment must use **full-page redirects**.

## Compatibility facts

- Flutter Wasm runs **only in Chrome/Edge/Chromium (≥ 119), desktop and Android**.
  Firefox, Safari and all iOS browsers **automatically use the JS build**.
- `velopack` ❌ cannot compile to Wasm (a C dependency, and it's a desktop updater anyway).
- `cratestack-client` 0.15.4 ✅ compiles to Wasm (needs rustc ≥ 1.98); a
  generated client is **753 KiB** before optimisation.
- WebTransport browser support: Chrome 97, Firefox 114, Safari 26.4, about 92 % of users.
- **nginx cannot proxy WebTransport**: the backend must handle QUIC itself, with UDP 443 open.

## Fallback decision

**WebSocket first. WebTransport later as an optional upgrade that falls back to
WebSocket. No HTTP polling.**

- Try WebTransport with a short timeout; on failure or drop, **switch to
  WebSocket** and don't keep retrying (Chrome's 5-minute penalty).
- Either way we need an **app heartbeat** (WebSocket never detects a dead
  link) and **message replay** (WebTransport loses in-flight messages).

## S11 follow-ups

1. Adopt Wasm + headers in the real app; keep native plugins behind conditional imports.
2. Cut first-load time on slow 4G: hashed file names + caching, Brotli,
   deferred loading.
3. Redirect-based login (P6) and payment (P12) because of COOP/COEP.
4. Wire `cratestack-client` to the web through flutter_rust_bridge's web target.
5. WebSocket with heartbeat + resume; revisit WebTransport with P11 results.
6. Test on a real low-end Android phone on MTN/Orange, plus Firefox and Safari.

## If asked "what wasn't tested?"

Chrome only (no Firefox or Safari), no physical phone, and the 4G profiles are
emulated rather than a real Cameroonian network. One outage test run was
flawed (failures carried over between tests) and was redone with a fresh
browser per test.
