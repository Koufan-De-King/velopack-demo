# Why Flutter Wasm, and why WebTransport: decisions and sources

Two decisions for the web version of the app, each backed by **official
sources** and by **our own measurements** from spike P10 (this folder).
Sources checked on 2026-10-23.

| Decision | In one line |
|---|---|
| **Build** | Ship the **Flutter Wasm** build. It's faster, smaller and smoother than the JavaScript build, and browsers that can't run it automatically get the JavaScript build. |
| **Real-time connection** | Use **WebTransport** as the main connection, with **WebSocket as the automatic fallback**. |

> **Note:** an earlier version of the report proposed WebSocket first. The
> measurements are the same; the team has chosen to optimise for performance
> on poor mobile networks, and the risks are handled by the fallback rules in
> Part 2. [REPORT.md §2 and §10](REPORT.md#10-fallback-decision) now match this.

---

## Part 1: Flutter's Wasm build

### 1.1 Why Wasm is better than the JavaScript build

Flutter can compile the app to **JavaScript** (`flutter build web`) or to
**WebAssembly** (`flutter build web --wasm`). WebAssembly is a compact binary
format that the browser runs close to native speed, without first having to
parse and optimise JavaScript.

| Benefit | Our measurement (Chrome 155, cold cache, 5 runs) | Source |
|---|---|---|
| **Faster start** | First frame on desktop: **238 ms vs 451 ms** (−47 %); ready to use: **238 vs 532 ms** (−55 %) | ours: [`REPORT.md` §7](REPORT.md#7-loading-benchmarks), [`results/bench.json`](results/bench.json) |
| **Smoother on slow phones** | Main thread blocked at startup (4× slower CPU, 4G): **367 ms vs 1,472 ms** (−75 %); longest freeze **~210 ms vs ~540 ms** | ours: same |
| **Smaller download** | **2,274 KiB vs 2,781 KiB** over the wire (−18 %) | ours: [`REPORT.md` §6](REPORT.md#6-javascript-vs-wasm-size), [`results/sizes.json`](results/sizes.json) |
| **Multithreaded rendering** | With the COOP/COEP headers the Wasm renderer (skwasm) draws on a separate thread; without them, startup freezes about twice as long | ours: [`results/verify.json`](results/verify.json), [`REPORT.md` §7](REPORT.md#7-loading-benchmarks); [Flutter docs](https://docs.flutter.dev/platform-integration/web/wasm) (multithreading needs the headers) |
| **Never worse** | Wasm was faster or equal in **every** profile and metric we measured | ours: [`REPORT.md` §7](REPORT.md#7-loading-benchmarks) |
| **Nobody loses** | A `--wasm` build also contains the JavaScript build, used automatically where Wasm can't run | [Flutter docs](https://docs.flutter.dev/platform-integration/web/wasm) |

### 1.2 Why it needs WasmGC

| # | Claim | Source |
|---|---|---|
| 1 | **Basic WebAssembly works in every modern browser**: Chrome 57, Firefox 52, Safari 11, Edge 16 (~97 % of users) | [caniuse: WebAssembly](https://caniuse.com/wasm) |
| 2 | Dart, like JavaScript, frees memory **automatically** (garbage collection). The original WebAssembly had no garbage collector, so a Dart app would have to ship its own, which adds size and is slower | [V8 blog: WasmGC porting](https://v8.dev/blog/wasm-gc-porting) |
| 3 | **WasmGC** lets Wasm code use the **browser's own garbage collector**: smaller binaries, and it reuses the browser's already fast collector | same V8 blog |
| 4 | **Flutter's Wasm build requires WasmGC** | [Flutter docs: Support for WebAssembly](https://docs.flutter.dev/platform-integration/web/wasm) |
| 5 | WasmGC shipped in **Chrome 119, Firefox 120, Safari 18.2** | [webassembly.org features](https://webassembly.org/features/) ([data](https://github.com/WebAssembly/website/blob/main/features.json)); [V8 blog](https://v8.dev/blog/wasm-gc-porting) |

### 1.3 Which browsers run it, and why

| Browser | Runs our app as Wasm? | Why | Source |
|---|---|---|---|
| **Chrome 119+** (Windows, macOS, Linux) | ✅ yes | WasmGC since 119; Flutter targets Chromium | [Flutter docs](https://docs.flutter.dev/platform-integration/web/wasm) |
| **Edge, Brave, Opera, Vivaldi** | ✅ yes | built on Chromium, same engine as Chrome | same |
| **Chrome on Android** | ✅ yes | same engine as desktop Chrome | same |
| **Firefox 120+** | ❌ gets JavaScript | has WasmGC, but a known bug blocks Flutter's Wasm renderer | same (Firefox section) |
| **Safari** (macOS) | ❌ gets JavaScript | has WasmGC, but a similar bug blocks Flutter's Wasm renderer | same (Safari section) |
| **Any browser on iPhone/iPad** | ❌ gets JavaScript | all iOS browsers must use Apple's WebKit engine, which doesn't yet support Flutter's Wasm | same (iOS section); [App Store Guideline 2.5.6](https://developer.apple.com/app-store/review/guidelines/#2.5.6) |

How a visitor gets the right version, automatically:

```
Visitor opens the web app
        │
        ▼
flutter_bootstrap.js: "does this browser support WasmGC?"
        │
   ┌────┴──────────────────────┐
   ▼ yes                        ▼ no
Chrome · Edge · Android       Firefox · Safari · iPhone
→ Wasm build (faster)          → JavaScript build (works as before)
```

**Verified by us:** in Chrome 155 the Wasm build really ran as Wasm
(`main.dart.wasm` and `skwasm.wasm` loaded; the app's Runtime card showed
*WebAssembly / dart2wasm*): [`results/verify.json`](results/verify.json),
[`results/screenshot-8443.png`](results/screenshot-8443.png).
**Not tested by us:** Firefox, Safari, iOS.

---

## Part 2: WebTransport as the real-time connection

### 2.1 What it is

WebTransport is the modern successor to WebSocket: a live connection between
the app and the server, but running on **HTTP/3 and QUIC (over UDP)** instead
of a single TCP connection ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)).

```
WebSocket:     app ══ one TCP lane ══ server       one lost packet stalls everything behind it
WebTransport:  app ══ QUIC (UDP) ═══ server       many independent streams + datagrams
                    ├─ stream 1 ─►
                    ├─ stream 2 ─►                 a lost packet only delays its own stream
                    └─ datagrams ►
```

### 2.2 Why we choose WebTransport

| # | Reason | Our measurement (4G: +150 ms RTT, 9 Mbit/s) | Source |
|---|---|---|---|
| 1 | **Faster connection setup**: QUIC combines the transport and encryption handshakes | connect **330 ms vs 482 ms**; first message **484 vs 637 ms** | ours: [`REPORT.md` §8](REPORT.md#8-webtransport-vs-websocket), [`results/transport.json`](results/transport.json) |
| 2 | **No head-of-line blocking**: a lost packet only delays its own stream, not the whole connection | small messages at 1 % loss: **3,649/s vs 981/s** (**3.7×**) | ours: same; [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API) |
| 3 | **Faster recovery from short network cuts** | 3 s cut: traffic back **0.4 s vs 2.8 s** after the network returned; 15 s cut: **0.6–0.8 s vs 8.4 s** | ours: [`results/transport-outages.json`](results/transport-outages.json) |
| 4 | **Detects dead connections by itself**: Chrome closes a silent session after ~7 s, so the app can reconnect; WebSocket never noticed even a 45 s outage | WebSocket: connection "alive" through a 45 s outage | ours: same |
| 5 | **Datagrams** for data that's useless if late (typing indicators, live progress), next to reliable streams | datagram round trip 154 ms, same as streams | ours: [`results/transport.json`](results/transport.json); [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API) |
| 6 | **Survives network changes** better: QUIC connections are identified by a connection ID, not the IP address (e.g. Wi-Fi ↔ mobile data) | not measured | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API) |
| 7 | **Wide browser support**: ~92 % of users, including Chrome 97, Edge 98, Firefox 114 and **Safari/iOS 26.4** | — | [caniuse: WebTransport](https://caniuse.com/webtransport) |
| 8 | **Same latency once connected** (no cost in normal conditions) | round trip **154 ms** for both | ours: [`results/transport.json`](results/transport.json) |

**Why this matters for our users:** reasons 1–3 are exactly the conditions of
congested mobile networks (packet loss, short drop-outs), where WebTransport
performed best in our tests.

### 2.3 Risks, and how we handle them

These risks are real and measured. They're the reason **WebSocket stays as
the fallback**: not as the main channel, but as the safety net.

| Risk | Evidence | How we handle it |
|---|---|---|
| **Some networks block UDP**, so WebTransport can't connect | 3–5 % of networks block all UDP; QUIC applications must be able to fall back to another transport ([RFC 9308 §2](https://www.rfc-editor.org/rfc/rfc9308.html#section-2)) | Try WebTransport with a **~3 s timeout**; on failure, connect over **WebSocket** automatically |
| **~8 % of browsers lack WebTransport** | [caniuse: WebTransport](https://caniuse.com/webtransport) vs [WebSockets](https://caniuse.com/websockets) (~97 %) | **Feature detection**: no `WebTransport` in the browser → use WebSocket |
| **Chrome throttles WebTransport after failures**: each failed handshake to a server adds a delay of up to **5 minutes**, remembered for **15 minutes** | Chromium source: [`web_transport_throttle_context.cc`](https://chromium.googlesource.com/chromium/src/+/main/content/browser/webtransport/web_transport_throttle_context.cc); in our tests, after repeated outages WebTransport didn't recover within 2 min | After a WebTransport failure, **switch to WebSocket at once** and don't retry WebTransport for ~15 minutes on that network |
| **Messages in flight are lost when a session drops** | 0 of 136 in-flight pings delivered after a 15 s cut | **Sequence numbers + replay** after reconnecting (needed for WebSocket too) |
| **Needs a dedicated QUIC server**: nginx's HTTP/3 module serves HTTP/3 but documents no WebTransport | [nginx: ngx_http_v3_module](https://nginx.org/en/docs/http/ngx_http_v3_module.html); WebTransport "requires a supporting server" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)) | The Rust backend terminates WebTransport itself (e.g. `wtransport`, or `h3` + `h3-webtransport`), with **UDP 443** open end to end; coordinate with **P11** (QUIC on Cameroonian networks) |

### 2.4 Connection rules for the client

```
start
  │
  ├─ browser has WebTransport?  ── no ──────────────────────────► WebSocket
  │        yes
  ├─ WebTransport failed on this network in the last 15 min? ─ yes ► WebSocket
  │        no
  ├─ try WebTransport (timeout ~3 s)
  │        ├─ connected ─► use WebTransport
  │        └─ failed / timed out ─► remember failure ─► WebSocket
  │
  └─ while connected: heartbeat; on drop → reconnect with the same rules,
     then replay unacknowledged messages by sequence number
```

---

## Sources

| Source | Used for |
|---|---|
| [Flutter: Support for WebAssembly](https://docs.flutter.dev/platform-integration/web/wasm) | Wasm requirements, browser support, fallback, multithreading |
| [V8 blog: WasmGC porting](https://v8.dev/blog/wasm-gc-porting) | why WasmGC exists, Chrome 119 |
| [webassembly.org features](https://webassembly.org/features/) | WasmGC versions per browser |
| [caniuse: WebAssembly](https://caniuse.com/wasm), [WebTransport](https://caniuse.com/webtransport), [WebSockets](https://caniuse.com/websockets) | browser support and usage |
| [App Store Review Guideline 2.5.6](https://developer.apple.com/app-store/review/guidelines/#2.5.6) | iOS browsers must use WebKit |
| [MDN: WebTransport API](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API) | what WebTransport is, streams, datagrams, server requirement, network changes |
| [RFC 9308 §2](https://www.rfc-editor.org/rfc/rfc9308.html#section-2) | UDP blocking and the need for fallback |
| [nginx: ngx_http_v3_module](https://nginx.org/en/docs/http/ngx_http_v3_module.html) | nginx HTTP/3 scope |
| [Chromium: web_transport_throttle_context.cc](https://chromium.googlesource.com/chromium/src/+/main/content/browser/webtransport/web_transport_throttle_context.cc) | handshake throttling after failures |
| This folder: [`REPORT.md`](REPORT.md), [`results/`](results/) | all our measurements |
