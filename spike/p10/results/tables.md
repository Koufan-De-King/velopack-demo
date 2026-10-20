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

### WebTransport vs WebSocket (Chrome/155.0.8059.79, 5 runs; mean / worst, ms)

| Condition | Transport | Connect | First message | RTT p50 | RTT p95 | Datagram RTT p50 (lost) | Small msgs/s (64 B) | Large Mbit/s (16 KiB) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| LAN (no shaping) | webtransport | 6.3 / 8.5 | 7.8 / 11.5 | 0.8 / 1.3 | 1.4 / 2.7 | 0.7 (0/500) | 435,841 | 651.8 |
| LAN (no shaping) | websocket | 4.1 / 4.9 | 5.1 / 6.1 | 0.7 / 0.8 | 1.0 / 1.5 | - | 8,099 | 498.6 |
| 4G: 150 ms RTT, 9/1.5 Mbit/s | webtransport | 330.2 / 333.5 | 483.6 / 487.4 | 153.9 / 154.1 | 155.3 / 155.6 | 153.7 (0/500) | 4,015 | 8.1 |
| 4G: 150 ms RTT, 9/1.5 Mbit/s | websocket | 482.5 / 501.2 | 636.6 / 654.6 | 153.9 / 154.0 | 154.6 / 155.2 | - | 2,638 | 8.2 |
| 4G + 1% loss each way | webtransport | 332.4 / 338.9 | 486.0 / 492.6 | 154.0 / 154.1 | 157.3 / 165.2 | 153.7 (14/500) | 3,649 | 2.5 |
| 4G + 1% loss each way | websocket | 478.2 / 479.4 | 631.9 / 634.1 | 153.9 / 154.0 | 154.7 / 155.0 | - | 981 | 2.7 |

### Temporary network loss (4G profile, 100% packet loss both ways, 3 runs; mean / worst)

| Outage | Transport | Transport noticed? | Detected after | Reconnect took | First msg after network back | Pings sent during outage delivered later | Lost pings |
|---:|---|---|---:|---:|---:|---:|---:|
| 3 s | websocket | closed in 0/3 | - | - | 2.8 / 2.8 s | 93/93 | 3 |
| 3 s | webtransport | closed in 0/3 | - | 71.9 / 94.1 s | 44.1 / 88.2 s | 31/31 | 5 |
| 15 s | websocket | closed in 0/3 | - | - | 8.3 / 8.4 s | 453/453 | 5 |
| 15 s | webtransport | closed in 3/3 | 6.8 / 6.8 s | 13.8 / 23.5 s | 5.6 / 15.3 s | 0/204 | 214 |
| 45 s | websocket | closed in 0/3 | - | - | 1.6 / 1.7 s | 1353/1353 | 5 |
| 45 s | webtransport | closed in 3/3 | 6.8 / 6.8 s | - | - (3 never) | 0/204 | 210 |

