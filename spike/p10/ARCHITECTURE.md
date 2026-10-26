# P10: basic architecture

## The big picture

```
                    ┌─────────────────────────┐
                    │      Flutter app        │
                    │  (lib/main.dart)        │
                    └───────────┬─────────────┘
                                │  flutter build web
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
          JavaScript build              WebAssembly build
                 │                             │
                 └──────────────┬──────────────┘
                                ▼
                    ┌─────────────────────────┐
                    │   nginx web server      │
                    │   + security headers    │
                    └───────────┬─────────────┘
                                │  HTTPS
                                ▼
                    ┌─────────────────────────┐
                    │     Chrome browser      │
                    │  (we measure speed and  │
                    │   check the headers)    │
                    └─────────────────────────┘


        Separate test, for real-time messages:

   ┌──────────────┐   WebSocket (TCP)      ┌──────────────┐
   │   Browser    │ ─────────────────────► │  Go test     │
   │  test page   │   WebTransport (UDP)   │  server      │
   │              │ ─────────────────────► │              │
   └──────────────┘                        └──────────────┘
          (both run in Docker so we can slow down
           and cut the network on purpose)
```

## The parts and what they do

| Part | What it is | What it does | Where |
|---|---|---|---|
| **Flutter app** | Our demo app | The thing we put on the web. Velopack (desktop updates) is switched off on the web, otherwise the page stays blank. | `lib/` |
| **Two builds** | JS and Wasm versions of the same app | JS works in every browser. Wasm is faster but only runs in Chrome/Edge; other browsers automatically get JS. | made by `deploy.sh` |
| **nginx** | Web server | Serves both builds and adds the two **security headers** that let the app draw with 2 CPU threads. | `spike/p10/deploy/` |
| **Test scripts** | Small programs that control Chrome | Open the app, check the headers work, and measure size and loading speed. | `spike/p10/bench/` |
| **Go test server + test page** | A mini real-time system | Sends the same messages over WebSocket and over WebTransport so we can compare them. | `spike/p10/transport/` |
| **Rust check** | Small Rust test projects | Checks whether our Rust code can be compiled for the browser. | `spike/p10/rust-wasm-check/` |
| **Report** | The results | All numbers, the recommendation, and the next steps. | `spike/p10/REPORT.md` |

## How they connect

1. **The app** is built twice → a **JS** version and a **Wasm** version.
2. **nginx** serves both versions to the browser, with the security headers.
3. **Chrome** opens the app. Our **test scripts** control Chrome and record:
   - which version ran (JS or Wasm),
   - whether the headers worked,
   - how fast it loaded and how many bytes it downloaded.
4. Separately, the **test page** talks to the **Go server** two ways (WebSocket
   and WebTransport) while we slow down or cut the network, to see which is better.
5. All the results go into `spike/p10/results/` and are summarised in **REPORT.md**.

## What we found, in one line each

- **Wasm:** about 2× faster on desktop and smoother on slow phones → use it.
- **Headers:** they work, but they block popups and embedded pages → login and payment must open as full pages.
- **Real-time:** **WebTransport** as the main connection, falling back to **WebSocket** automatically.
- **Rust:** our API client can run on the web; Velopack can't (and doesn't need to).
- **Still to do:** the first visit on slow 4G is too slow (16–19 s).
