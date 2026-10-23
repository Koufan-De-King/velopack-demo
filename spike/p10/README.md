# Spike P10: Flutter web with Wasm, COOP/COEP headers and WebTransport

A **spike** is a short, time-boxed experiment that answers a technical question
before the team commits to a design. This folder holds everything spike P10
produced: the report, the server configuration, the scripts that measured
everything, and the raw results.

> **Question:** should the web version of the app ship as a Flutter
> **WebAssembly** build behind the **COOP/COEP** security headers, and should
> real-time messages use **WebTransport** or **WebSocket**?

## Answer in short

| Topic | Decision |
|---|---|
| Web build | Use **Wasm** (`flutter build web --wasm --no-web-resources-cdn`). In Chrome it's ~2× faster on desktop and downloads ~18 % less; other browsers automatically get the JavaScript build. |
| Security headers | `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless`. They enable 2-thread rendering, but they block popups and cross-origin iframes, so login and payment must use full-page redirects. |
| Real-time messages | **WebSocket** for now; WebTransport later, as an optional upgrade that falls back to WebSocket. |
| Rust code in the browser | `cratestack-client` compiles to Wasm; Velopack can't (and doesn't need to). |
| Biggest open problem | The first visit on slow 4G takes 16–19 s. |

Full details and numbers: **[REPORT.md](REPORT.md)**.

## What's in this folder

| Path | What it is |
|---|---|
| [`REPORT.md`](REPORT.md) | **The full spike report**: question, setup, all measurements, compatibility issues, recommendation, follow-ups for S11 |
| [`BRIEFING.md`](BRIEFING.md) | Short version: key numbers and talking points |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Simple diagram of the parts and how they connect |
| [`deploy/`](deploy/) | Builds the JS and Wasm versions and serves them with nginx and the headers. **[`deploy/flutter-web.conf`](deploy/flutter-web.conf) is the header configuration to reuse.** See [`deploy/README.md`](deploy/README.md). |
| [`bench/`](bench/) | Scripts that drive Chrome: header and multithreading checks (`verify.mjs`), what the headers block (`coep-assets.mjs`), loading benchmarks (`bench.mjs`) |
| [`transport/`](transport/) | WebTransport vs WebSocket prototype: Go server, browser client, Docker benchmark. See [`transport/README.md`](transport/README.md). |
| [`rust-wasm-check/`](rust-wasm-check/) | Checks whether our Rust crates compile for the browser. See [`rust-wasm-check/README.md`](rust-wasm-check/README.md). |
| [`scripts/`](scripts/) | `sizes.py` (file sizes) and `analyze.py` (turns the results into the report's tables) |
| [`results/`](results/) | Raw measurements (JSON) and screenshots |

The app changes for this spike are outside this folder, in
[`lib/platform/`](../../lib/platform/): Velopack is desktop-only, so the web
build uses a separate platform file (without it, the web page stays blank).

## Requirements

| Tool | Version used | Needed for |
|---|---|---|
| Flutter | 3.47.7 (≥ 3.24) | building the app |
| nginx | 1.31.7 | serving the builds (`brew install nginx`) |
| Node.js | 24 | the `bench/` scripts (`npm ci` in `bench/`) |
| Google Chrome | 155 (≥ 119) | running Wasm and the benchmarks |
| Docker | 29 | the transport benchmark only |
| Rust | rustc 1.98 + `wasm32-unknown-unknown` | the Rust check only |
| Python 3, openssl, gzip, brotli | any recent | size analysis and certificates |

## Quick start

Run from the repository root.

**1. Build both versions and serve them** (a few minutes):

```bash
./spike/p10/deploy/deploy.sh
```

Then open `https://localhost:8443/` (Wasm) or `https://localhost:8444/` (JS).
The certificate is self-signed; see [`deploy/README.md`](deploy/README.md)
for opening Chrome without a warning.

**2. Check the headers:**

```bash
curl -skI https://localhost:8443/ | grep -i cross-origin
```

**3. Check isolation, Wasm and multithreading in Chrome:**

```bash
(cd spike/p10/bench && npm ci && node verify.mjs) | grep -E '"name"|"crossOriginIsolated"|"multithreaded"'
```

**4. Print the results tables:**

```bash
python3 spike/p10/scripts/analyze.py
```

**5. Stop the server:**

```bash
nginx -p "$PWD/spike/p10/deploy" -c nginx.conf -s stop
```

## Re-running the measurements

| Measurement | Command | Time |
|---|---|---|
| Loading benchmarks | `(cd spike/p10/bench && RUNS=5 node bench.mjs > ../results/bench.json)` | ~15 min |
| What the headers block | `(cd spike/p10/bench && node coep-assets.mjs > ../results/coep-assets.json)` | ~1 min |
| File sizes | `python3 spike/p10/scripts/sizes.py js spike/p10/deploy/www/js wasm spike/p10/deploy/www/wasm > spike/p10/results/sizes.json` | ~1 min |
| WebTransport vs WebSocket | see [`transport/README.md`](transport/README.md) | ~1 hour |
| Rust → Wasm | see [`rust-wasm-check/README.md`](rust-wasm-check/README.md) | a few minutes |

## Status and limits

- Measured on one MacBook Pro (Intel i7, 2018) with Chrome 155, on 2026-10-20.
- Not tested: Firefox, Safari, a real phone, a real Cameroonian mobile network
  (4G was simulated).
- This is a **spike**: the code here is for measuring, not for production.
  What to carry over into S11 is listed in [REPORT.md §11](REPORT.md#11-follow-up-work-for-s11).
