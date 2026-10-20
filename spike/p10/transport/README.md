# P10: WebTransport vs WebSocket prototype

One Go server and one browser client speak the **same tiny binary protocol**
over both transports, so the comparison is like-for-like:

| | WebTransport | WebSocket |
|---|---|---|
| URL | `https://HOST:9443/wt` | `wss://HOST:9443/ws` |
| Wire | HTTP/3 → QUIC → **UDP** 9443 | HTTP/1.1 Upgrade → TLS 1.3 → **TCP** 9443 |
| Server lib | `quic-go/webtransport-go` v0.13.0 (`quic-go` v0.62.0) | `coder/websocket` v1.8.15 |
| Framing | one bidirectional stream, u32 length prefix per frame (+ datagrams) | one binary message per frame |

Frame: `[type u8][seq u32][client timestamp f64][payload]`. `P` = ping (echoed),
`S` = "send me *count* frames of *size* bytes" (server streams `D` frames then `E`).
See [`server/main.go`](server/main.go) and [`server/static/client.js`](server/static/client.js).

## Run the benchmark

```bash
cd spike/p10/transport
./gen-cert.sh                                   # 13-day ECDSA cert (see below)
docker compose up --build --abort-on-container-exit --exit-code-from bench
python3 ../scripts/analyze.py                   # tables from results/transport.json
```

`RUNS` (default 5) and `OUTAGE_RUNS` (default 3) are environment variables.

Why Docker: the browser (headless Chromium in the `bench` container) and the
server sit on one Linux bridge network. Latency, bandwidth and loss are applied
with `tc netem` on each side's egress, filtered to port 9443 only, so TCP and
UDP packets are delayed or dropped **in the kernel** exactly the same way.
Doing this on macOS needs root (`dnctl`/`pfctl`), and a userspace proxy would
terminate TCP and hide its retransmission behaviour. Two pitfalls found while
building the harness:

- An `iptables -j DROP` on the sender's OUTPUT chain makes `sendmsg()` return
  `EPERM`. Chromium's QUIC treats that as fatal and closes in ~100 ms, which is
  not what a real outage does. Use netem `loss 100%`, which drops silently.
- A root netem `loss 100%` also kills ARP and the control channel, so the
  impairment is attached to a `prio` band with a `u32` port filter.

Network conditions: **LAN** (none), **4G** (+150 ms RTT, 9 Mbit/s down,
1.5 Mbit/s up), **4G + 1 % loss each way**. Outages: 3 s, 15 s and 45 s of 100 %
loss in both directions on the 4G profile.

The client reconnects when the *transport* reports a close (backoff 100 ms ×2
up to 2 s, 3 s per-attempt connect timeout). There is deliberately **no
application heartbeat**, so the results show each transport's native failure
detection.

## Try it from a desktop browser

`docker compose up wt-server` also publishes 9443/tcp+udp on the host. Open
`https://localhost:9443/` in Chrome after trusting the certificate, for example
by starting Chrome with
`--ignore-certificate-errors-spki-list=$(cat certs/server.spki.b64)`, and press
*Run quick comparison*.

## Server configuration required for WebTransport in production

1. **HTTP/3 with the WebTransport extension.** The server must send the
   SETTINGS `ENABLE_CONNECT_PROTOCOL`, `H3_DATAGRAM`, `WT_MAX_SESSIONS ≥ 1`
   (Safari requires it) and accept extended `CONNECT` with `:protocol =
   webtransport` (`webtransport.ConfigureHTTP3Server` does this). A plain
   HTTP/3 reverse proxy is **not** enough: nginx's `http_v3_module` serves
   HTTP/3 but does not proxy WebTransport sessions. The Rust service has to
   terminate QUIC itself (e.g. `wtransport` or `h3` + `h3-webtransport` with
   `quinn`), or sit behind a load balancer that passes UDP through.
2. **UDP 443 open end to end**: firewall, security groups, load balancer
   (UDP/QUIC passthrough, ideally QUIC-ID-aware so connection migration still
   works).
3. **A publicly trusted certificate.** `serverCertificateHashes` (used in this
   prototype) only accepts ECDSA certs valid < 14 days and is meant for
   development or peer-to-peer use, not production.
4. Keep the **WebSocket endpoint on TCP 443** on the same origin as the fallback.
5. Corporate and mobile networks that block or throttle UDP make the QUIC
   handshake fail. The client must time it out quickly (3 s here) and fall back.

## Browser support (caniuse, October 2026)

| | WebTransport | WebSocket |
|---|---|---|
| Chrome / Edge | 97 / 98 | all |
| Firefox | 114 | all |
| Safari macOS / iOS | **26.4** | all |
| Chrome Android | yes (current) | all |
| Samsung Internet | 18.0 | all |
| Global usage | ~91.6 % | ~99 %+ |

Measured here with headless Chromium 155 (Debian) in Docker. Firefox and
Safari were **not** measured in this spike.
