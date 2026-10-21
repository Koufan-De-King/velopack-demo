# P10 demo script

How to present spike P10 (Flutter web with Wasm, COOP/COEP headers,
WebTransport) live: what to say, what to run, and what you should see.

- **Length:** about 15 minutes (10 without the optional parts).
- **Run all commands from the repository root** (`~/Projects/velopack-demo`)
  unless a step says otherwise.
- Numbers to quote: [`BRIEFING.md`](BRIEFING.md). Full detail: [`REPORT.md`](REPORT.md).

---

## 0. Prepare (before the meeting, about 10 minutes)

| Need | Check with |
|---|---|
| Flutter ≥ 3.24 | `flutter --version` |
| nginx | `nginx -v` (if missing: `brew install nginx`) |
| Node.js | `node -v` |
| Google Chrome | installed in `/Applications` |
| Docker Desktop (optional parts only) | `docker info` |

**0.1 Get the branch**

```bash
cd ~/Projects/velopack-demo && git switch spike/p10-flutter-wasm-webtransport && git pull
```

**0.2 Build both versions and start the web server.** This takes a few minutes:
two Flutter builds, then maximum compression.

```bash
./spike/p10/deploy/deploy.sh
```

✅ Expected: at the end,

```
source tree: <hash> (HEAD <commit>)
✓ Built build/web        (twice)
Wasm: https://localhost:8443/   JS: https://localhost:8444/
```

> If it fails with an expired certificate (it is valid for 13 days), run
> `rm -rf spike/p10/deploy/certs` and run `deploy.sh` again.

**0.3 Install the test-script dependencies** (once):

```bash
(cd spike/p10/bench && npm ci)
```

**0.4 Open the demo Chrome window.** This is a separate profile that trusts the
local certificate, so no warning page appears.

```bash
open -na "Google Chrome" --args --user-data-dir=/tmp/p10-demo --ignore-certificate-errors-spki-list=$(cat spike/p10/deploy/certs/localhost.spki.b64) https://localhost:8443/ https://localhost:8444/ https://localhost:8445/
```

✅ Expected: a new Chrome window with **3 tabs**, each showing the dark
"Velopack + Flutter" screen.

**0.5 (Optional parts only)** Start Docker Desktop and pre-build the transport
images, so the live run doesn't wait for downloads:

```bash
(cd spike/p10/transport && ./gen-cert.sh && docker compose build)
```

Do one full rehearsal of steps 1–8 so nothing surprises you live.

---

## 1. The question (1 min, no commands)

🗣️ **Say:**
> "Spike P10 asked three things. First, should the web version of our app
> use Flutter's new WebAssembly mode, and how big and fast is it? Second,
> which security headers does it need, and what do they break? Third, for
> real-time messages, is the new WebTransport better than WebSocket?
> I used the Velopack demo app as the test app."

🗣️ **Show the architecture:**

```
Browser (Chrome)
   │ HTTPS
   ▼
nginx ── serves the Flutter web app: JS version + Wasm version
         with the COOP/COEP headers that unlock faster rendering

Go test server ── the same messages sent two ways:
   ├── WebSocket     (TCP, the classic way)
   └── WebTransport  (QUIC/UDP, the new way)
```

---

## 2. First problem found: blank page (1 min)

🗣️ **Say:**
> "The first finding: the app built for the web, but showed a **blank page**.
> Velopack is a desktop updater written in Rust, and it can't load in a
> browser, so the app got stuck at startup. I moved Velopack behind a
> desktop-only import, so the web build never touches it."

▶️ **Run:**

```bash
cat lib/platform/platform.dart
```

✅ **Expected:**

```dart
// Desktop builds use Velopack (Rust over dart:ffi) for updates. Web builds
// cannot load that native core, so they get a stub that disables updates.
export 'platform_io.dart' if (dart.library.js_interop) 'platform_web.dart';
```

🗣️ "Desktop gets `platform_io.dart` with Velopack; the web gets
`platform_web.dart`, where updates are off."

---

## 3. Two builds from the same code (2 min)

🗣️ **Say:**
> "I built two versions from exactly the same code: the normal JavaScript one,
> and the WebAssembly one."

▶️ **Show the build commands** (already run in step 0.2; don't rerun live):

```bash
flutter build web --release --no-web-resources-cdn
flutter build web --release --wasm --no-web-resources-cdn
```

🗣️ "`--no-web-resources-cdn` makes the app load its renderer from **our**
server instead of Google's CDN."

▶️ **Run (proves both builds come from the same source):**

```bash
cat spike/p10/deploy/www/js/SOURCE_TREE spike/p10/deploy/www/wasm/SOURCE_TREE
```

✅ **Expected:** the **same hash twice**.

▶️ **Run (size table):**

```bash
python3 spike/p10/scripts/analyze.py | sed -n '/Critical files/,/Loading benchmarks/p'
```

✅ **Expected:** a table ending with

```
| js   | **app + renderer** | **7,291** | **2,597** | **1,967** |
| wasm | **app + renderer** | **5,127** | **2,091** | **1,650** |
```

🗣️ "What Chrome downloads: **2.6 MB for JavaScript vs 2.1 MB for Wasm**
compressed, about **18–20 % less**."

---

## 4. The Wasm build really runs as Wasm (2 min)

In the demo Chrome window:

▶️ **Tab `localhost:8443`** (Wasm build):
- Point at the **Runtime** card.

  ✅ It reads **"Web (WebAssembly / dart2wasm)"**.
- Press **Cmd+Option+J** (Console) and type `crossOriginIsolated`.

  ✅ `true`
- Type `typeof SharedArrayBuffer`.

  ✅ `"function"`
- Open the **Network** tab and reload (Cmd+R).

  ✅ You see `main.dart.wasm` and `skwasm.wasm` from `localhost:8443`.
  There is **no** `main.dart.js` and nothing from `gstatic.com`.

▶️ **Tab `localhost:8444`** (JS build):

  ✅ The Runtime card reads **"Web (JavaScript / dart2js)"**.

🗣️ **Say:**
> "Same app, two builds. The card tells us which one is running, so we know
> Chrome isn't silently falling back to JavaScript. Firefox, Safari and all
> iPhone browsers don't support Flutter Wasm yet; they automatically get the
> JavaScript version from the same server, so nobody is left out."

---

## 5. The headers (3 min)

🗣️ **Say:**
> "To use several CPU threads for drawing, the browser requires two
> security headers. This is the configuration I'm proposing."

▶️ **Run:**

```bash
cat spike/p10/deploy/flutter-web.conf
```

✅ **Expected:** the block with
`Cross-Origin-Opener-Policy "same-origin"` and
`Cross-Origin-Embedder-Policy "credentialless"`.

▶️ **Run (what the server really sends):**

```bash
curl -skI https://localhost:8443/ | grep -i cross-origin
```

✅ **Expected:**

```
cross-origin-opener-policy: same-origin
cross-origin-embedder-policy: credentialless
```

▶️ **Tab `localhost:8445`** (same Wasm build, **no headers**): open the Console.

✅ A warning: **"Skwasm will run in single-threaded mode"**.

🗣️ "Without the headers it still works, but drawing happens on the main
thread, and the app freezes about **twice as long** on a slow phone."

▶️ **Run the automatic check of all four server variants** (~20 s):

```bash
(cd spike/p10/bench && node verify.mjs) | grep -E '"name"|"crossOriginIsolated"|"runtime"|"multithreaded"'
```

✅ **Expected** (4 blocks):

| name | crossOriginIsolated | runtime | multithreaded |
|---|---|---|---|
| wasm + COOP/COEP credentialless | true | WebAssembly / dart2wasm | **true** |
| js + COOP/COEP credentialless | true | JavaScript / dart2js | false (JS never uses it) |
| wasm, no isolation headers | false | WebAssembly / dart2wasm | **false** |
| wasm + COOP/COEP require-corp | true | WebAssembly / dart2wasm | **true** |

▶️ **Run: what the headers break** (~30 s, needs internet):

```bash
(cd spike/p10/bench && node coep-assets.mjs) | grep -E '"name"|img no-cors, no CORP|iframe|popup'
```

✅ **Expected:**

| | no headers | credentialless | require-corp |
|---|---|---|---|
| image from a site without a CORP header | loaded | **loaded** | **blocked/error** |
| cross-origin iframe | load event (works) | load event, but **blocked** in the network log | same, **blocked** |
| popup (`window.open`) | `handle.closed=false` | **`handle.closed=true`** | **`handle.closed=true`** |

(The iframe's `load` event fires even when it is blocked; the full JSON
shows `ERR_BLOCKED_BY_RESPONSE` under `blockedRequests`.)

🗣️ **Say:**
> "Two choices exist. `require-corp` blocked a normal third-party image, and
> `credentialless` didn't, so I recommend `credentialless`. With **both**, the
> page loses access to popups and blocks embedded pages from other sites. So
> **login (P6) and payment (P12) must use full-page redirects**, not popups
> or iframes. That's the main product decision this spike raises."

---

## 6. Loading speed (2 min)

🗣️ **Say:**
> "I measured both builds in 4 situations, from a fast desktop to a slow phone
> on a slow 4G network, with an empty and a full cache, 5 times each."

▶️ **Optional quick live run** (~15 s, desktop only, 1 run):

```bash
(cd spike/p10/bench && RUNS=1 PROFILES="desktop, unthrottled" BUILDS="js|wasm" node bench.mjs > /tmp/p10-quick.json)
```

✅ **Expected** (a single run is noisy; the numbers vary):

```
desktop, unthrottled | js | run 1 | cold ff=450–760 warm ff=450–480
desktop, unthrottled | wasm | run 1 | cold ff=240–270 warm ff=240–320
```

`ff` = milliseconds until the app's first frame. Wasm is clearly faster;
the averaged table below is the number to quote (**about twice as fast**).

▶️ **Show the full results table** (the real measurements):

```bash
python3 spike/p10/scripts/analyze.py | sed -n '/Loading benchmarks/,/WebTransport vs/p'
```

or show the table in `BRIEFING.md`. Points to make:

| | JavaScript | Wasm |
|---|---:|---:|
| Desktop: first frame | 451 ms | **238 ms** |
| Slow phone, 4G: ready to use | 4.3 s | **3.5 s** |
| Slow phone: main thread blocked | 1,472 ms | **367 ms** |
| Slow phone, slow 4G: first visit | 18.9 s | **16.5 s** |

🗣️ **Say:**
> "Wasm never lost a single measurement. The weak spot is the **first visit
> on a slow network: 16–19 seconds for both builds**. Reducing that is the
> main job for S11."

---

## 7. Can our Rust code run in the browser? (2 min, optional live)

🗣️ **Say:**
> "I checked whether our Rust code compiles for the browser."

▶️ **Run (cratestack: works).** Fast if built before; the first time it
downloads rustc 1.98 and takes about 2 minutes.

```bash
(cd spike/p10/rust-wasm-check && cargo build -p check-cratestack-generated --target wasm32-unknown-unknown && echo "OK: cratestack client compiles to Wasm")
```

✅ **Expected:** `OK: cratestack client compiles to Wasm`

▶️ **Run (velopack: does not work):**

```bash
(cd spike/p10/rust-wasm-check && cargo build -p check-velopack --target wasm32-unknown-unknown 2>&1 | grep -E "^error" | head -3)
```

✅ **Expected:** errors such as
`failed to run custom build command for 'ring'` and the `getrandom` error
about the `js` feature.

🗣️ **Say:**
> "`cratestack-client` compiles to Wasm, including a client generated from a
> schema, so our API client can run on the web later. Velopack can't, and
> doesn't need to: on the web, updates are just the server sending new files."

---

## 8. WebTransport vs WebSocket (3 min)

🗣️ **Say:**
> "I built a small Go server that sends the same messages over WebSocket and
> over WebTransport. I ran it in Docker so I could slow the network down and
> cut it completely, on real packets."

▶️ **Show the results** (the full run takes about an hour, so present the
stored results):

```bash
python3 spike/p10/scripts/analyze.py | sed -n '/WebTransport vs/,$p'
```

or the tables in `BRIEFING.md`. Points to make:

| On 4G | WebTransport | WebSocket |
|---|---:|---:|
| Connect | **330 ms** | 482 ms |
| Round trip once connected | 154 ms | 154 ms |
| Small messages/s at 1 % packet loss | **3,649** | 981 |
| Network cut 15 s | session dropped, back **0.7 s** after the network, in-flight messages **lost** | never noticed, messages **8 s late**, none lost |
| Repeated failures | **Chrome blocks retries for up to 5 min** | fine |

▶️ **Optional live run** (Docker running, images pre-built in 0.5; about 4 minutes):

```bash
(cd spike/p10/transport && RUNS=1 OUTAGE_RUNS=1 OUTAGES=3000 docker compose up --abort-on-container-exit --exit-code-from bench 2>&1 | grep -E "bench-1 .*(run 1|outage)" | cut -c1-140; docker compose down)
```

✅ **Expected** (roughly):

```
LAN (no shaping) | webtransport | run 1 | connect 6 rtt p50 0.8
LAN (no shaping) | websocket    | run 1 | connect 4 rtt p50 0.7
4G: 150 ms RTT ... | webtransport | run 1 | connect 330 rtt p50 154
4G: 150 ms RTT ... | websocket    | run 1 | connect 480 rtt p50 154
...
outage 3000 | webtransport | ... "firstMessageAfterRestoreMs":4xx ...
outage 3000 | websocket    | ... "firstMessageAfterRestoreMs":28xx ...
```

🗣️ "WebTransport connects one round trip faster and recovers from a 3-second
cut in under half a second; WebSocket takes almost 3 seconds."

▶️ **Optional: show it in a browser.** Start the server in its own terminal:

```bash
(cd spike/p10/transport && docker compose up --build wt-server)
```

Then, in another terminal:

```bash
open -na "Google Chrome" --args --user-data-dir=/tmp/p10-demo2 --ignore-certificate-errors-spki-list=$(cat spike/p10/transport/certs/server.spki.b64) https://localhost:9443/
```

✅ The page says **"WebTransport supported: true"**. Click **Run quick
comparison** and two JSON results appear, one per transport. Numbers are
tiny because there is no network delay on your laptop.

🗣️ **Say (the decision):**
> "Decision: **release 1 uses WebSocket**. WebTransport is better on bad
> networks, but it needs a special server (nginx can't proxy it), UDP open
> everywhere, and Chrome blocks it for minutes after repeated failures. So
> it can come later as an optional upgrade that **falls back to WebSocket**.
> Either way we need a heartbeat and message replay, because WebSocket never
> notices a dead link and WebTransport loses messages in flight. No HTTP
> polling."

---

## 9. Wrap-up (1 min)

🗣️ **Say:**
> "Recommendation for S11:
> 1. Use the **Wasm build** with the **`credentialless` headers**.
> 2. **WebSocket** for real-time; WebTransport later, with fallback.
> 3. **Login and payment via redirects**, not popups or iframes.
> 4. Make the **first visit faster on slow networks**.
> 5. Connect our **Rust client** to the web app.
> 6. Test on a **real Android phone, Firefox and Safari**.
>
> Everything is on the branch `spike/p10-flutter-wasm-webtransport`: the
> report, the server config, the deploy script and all the test scripts."

---

## Likely questions

| Question | Answer |
|---|---|
| Does it work on iPhone? | Yes, as the JavaScript version. No iOS browser can run Flutter Wasm yet. |
| Does Safari support `credentialless`? | No, but Safari runs the JS version anyway, so it doesn't matter today. |
| Why not `require-corp`? | It blocked a normal third-party image; `credentialless` didn't. Both give the same speed. |
| What did you not test? | Firefox, Safari and a real phone; the 4G networks were simulated, not a real MTN/Orange connection. |
| Why is the first visit so slow on slow 4G? | ~2.3 MB has to download. Fixes: better caching, Brotli, splitting the app into pieces (S11). |
| Can nginx do WebTransport? | No. It serves HTTP/3 but can't proxy WebTransport; the backend must handle it. |
| How reliable are the numbers? | 5 runs per case, average and worst reported, and JS and Wasm alternated. One outage test run was flawed and redone. |

---

## After the demo: clean up

```bash
nginx -p ~/Projects/velopack-demo/spike/p10/deploy -c nginx.conf -s stop
```

If you used the transport demo:

```bash
(cd ~/Projects/velopack-demo/spike/p10/transport && docker compose down)
```

Close the demo Chrome windows. Their profiles live in `/tmp/p10-demo*` and
can be deleted.

---

## If something goes wrong

| Problem | Fix |
|---|---|
| `deploy.sh`: "address already in use" | nginx is already running: `nginx -p spike/p10/deploy -c nginx.conf -s reload` |
| Chrome shows a certificate warning | You opened a normal window. Close it and use the command from step 0.4. |
| Runtime card says *dart2js* on port 8443 | It's not Chrome (or Chrome < 119). Use the step 0.4 window. |
| `node verify.mjs` can't find puppeteer | Run `(cd spike/p10/bench && npm ci)`. |
| Certificate expired (after 13 days) | `rm -rf spike/p10/deploy/certs && ./spike/p10/deploy/deploy.sh` |
| Docker commands hang | Start Docker Desktop and wait until `docker info` works. |
