// P10 transport client: the same frame protocol over WebTransport and WebSocket
// (see server/main.go). `bench.*` is driven by bench/transport-bench.mjs.
const HEADER = 13;
const TYPES = { P: 80, S: 83, D: 68, E: 69 };

function frame(type, seq, payloadLen = 0) {
  const b = new Uint8Array(HEADER + payloadLen);
  const v = new DataView(b.buffer);
  b[0] = TYPES[type];
  v.setUint32(1, seq);
  v.setFloat64(5, performance.now());
  return b;
}
const parse = (b) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { type: String.fromCharCode(b[0]), seq: v.getUint32(1), ts: v.getFloat64(5), len: b.byteLength };
};

const origin = () => location.host;

// Fetched once, outside the timed connection setup.
const certHash = fetch('/cert-hash').then((r) => r.text());

// Abort a connection attempt that has not completed after this long: a QUIC
// handshake started during an outage otherwise keeps backing off for tens of
// seconds after the network is back.
// 0 disables it. Settable from the benchmark driver.
let CONNECT_TIMEOUT_MS = 3000;

class WebTransportConn {
  static async open(onFrame, onClose) {
    const hash = await certHash;
    const c = new WebTransportConn();
    c.wt = new WebTransport(`https://${origin()}/wt`, {
      serverCertificateHashes: [{ algorithm: 'sha-256', value: Uint8Array.from(atob(hash), (ch) => ch.charCodeAt(0)) }],
    });
    const timer = CONNECT_TIMEOUT_MS && setTimeout(() => c.wt.close(), CONNECT_TIMEOUT_MS);
    try {
      await c.wt.ready;
    } finally {
      clearTimeout(timer);
    }
    c.wt.closed.then(() => onClose('closed'), (e) => onClose(`closed: ${e.message}`));
    const stream = await c.wt.createBidirectionalStream();
    c.writer = stream.writable.getWriter();
    c.dgWriter = c.wt.datagrams.writable.getWriter();
    c.onDatagram = null;
    (async () => { // length-prefixed frames on the bidi stream
      const reader = stream.readable.getReader();
      let buf = new Uint8Array(0);
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ done: true }));
        if (done) return;
        const nb = new Uint8Array(buf.length + value.length);
        nb.set(buf); nb.set(value, buf.length); buf = nb;
        let off = 0;
        while (buf.length - off >= 4) {
          const n = new DataView(buf.buffer, buf.byteOffset + off).getUint32(0);
          if (buf.length - off - 4 < n) break;
          onFrame(buf.subarray(off + 4, off + 4 + n));
          off += 4 + n;
        }
        buf = buf.slice(off);
      }
    })();
    (async () => {
      const r = c.wt.datagrams.readable.getReader();
      for (;;) {
        const { value, done } = await r.read().catch(() => ({ done: true }));
        if (done) return;
        c.onDatagram?.(value);
      }
    })();
    return c;
  }
  send(f) {
    const b = new Uint8Array(4 + f.length);
    new DataView(b.buffer).setUint32(0, f.length);
    b.set(f, 4);
    return this.writer.write(b);
  }
  sendDatagram(f) { return this.dgWriter.write(f); }
  close() { try { this.wt.close(); } catch {} }
}

class WebSocketConn {
  static open(onFrame, onClose) {
    return new Promise((resolve, reject) => {
      const c = new WebSocketConn();
      c.ws = new WebSocket(`wss://${origin()}/ws`);
      c.ws.binaryType = 'arraybuffer';
      c.ws.onmessage = (e) => onFrame(new Uint8Array(e.data));
      const timer = CONNECT_TIMEOUT_MS && setTimeout(() => c.ws.close(), CONNECT_TIMEOUT_MS);
      c.ws.onopen = () => { clearTimeout(timer); resolve(c); };
      c.ws.onerror = () => { clearTimeout(timer); reject(new Error('websocket error')); };
      c.ws.onclose = (e) => onClose(`closed: code ${e.code}`);
    });
  }
  send(f) { this.ws.send(f); }
  close() { try { this.ws.close(); } catch {} }
}

const OPEN = { webtransport: WebTransportConn.open, websocket: WebSocketConn.open };

// A connection with an awaitable "next frame matching predicate" helper.
async function connect(transport, onClose = () => {}) {
  const waiters = [];
  let onAny = null;
  const conn = await OPEN[transport]((b) => {
    const f = parse(b);
    onAny?.(f);
    const i = waiters.findIndex((w) => w.match(f));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(f);
  }, onClose);
  conn.next = (match, timeoutMs = 30000) => new Promise((resolve, reject) => {
    const w = { match, resolve };
    waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('timeout')); } }, timeoutMs);
  });
  conn.setOnAny = (fn) => { onAny = fn; };
  return conn;
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p95: q(0.95), max: s.at(-1) };
};

async function throughput(conn, count, size) {
  let got = 0;
  conn.setOnAny((f) => { if (f.type === 'D') got++; });
  const req = frame('S', 0, 8);
  new DataView(req.buffer).setUint32(HEADER, count);
  new DataView(req.buffer).setUint32(HEADER + 4, size);
  const t0 = performance.now();
  const end = conn.next((f) => f.type === 'E', 120000);
  conn.send(req);
  await end;
  const ms = performance.now() - t0;
  conn.setOnAny(null);
  return { count, size, received: got, ms, msgsPerSec: (got / ms) * 1000, mbitPerSec: (got * size * 8) / ms / 1000 };
}

export const bench = {
  setConnectTimeout(ms) { CONNECT_TIMEOUT_MS = ms; },
  supported: () => ({ webtransport: typeof WebTransport === 'function', websocket: typeof WebSocket === 'function' }),

  // Connection time, time to first message, RTT and throughput on a fresh connection.
  async run(transport, { pings = 100, payload = 64, small = [20000, 64], large = [2000, 16384] } = {}) {
    await certHash;
    const t0 = performance.now();
    const conn = await connect(transport);
    const tReady = performance.now();
    const first = conn.next((f) => f.type === 'P' && f.seq === 0);
    conn.send(frame('P', 0, payload));
    await first;
    const tFirst = performance.now();
    const rtts = [];
    for (let i = 1; i <= pings; i++) {
      const echo = conn.next((f) => f.type === 'P' && f.seq === i);
      const s = performance.now();
      conn.send(frame('P', i, payload));
      await echo;
      rtts.push(performance.now() - s);
    }
    let datagramRtt = null;
    if (transport === 'webtransport') {
      const d = [];
      let lost = 0;
      for (let i = 0; i < pings; i++) {
        const got = new Promise((res) => { conn.onDatagram = (b) => { const f = parse(b); if (f.seq === i) res(performance.now() - f.ts); }; setTimeout(() => res(null), 1000); });
        await conn.sendDatagram(frame('P', i, payload));
        const r = await got;
        if (r === null) lost++; else d.push(r);
      }
      datagramRtt = { ...stats(d), lost };
    }
    const smallRes = await throughput(conn, ...small);
    const largeRes = await throughput(conn, ...large);
    conn.close();
    return {
      transport, connectMs: tReady - t0, firstMessageMs: tFirst - t0,
      rtt: stats(rtts), datagramRtt, throughputSmall: smallRes, throughputLarge: largeRes,
    };
  },

  // Outage test: ping every 100 ms with a reliable stream/message; reconnect
  // when the transport itself reports the connection closed (no app-level
  // heartbeat, so this shows each transport's native behaviour).
  outage: null,
  startOutageProbe(transport) {
    const log = { transport, events: [], sent: new Map(), recv: new Map(), reconnects: [] };
    let conn = null, seq = 0, alive = false, stopped = false, timer = null;
    const ev = (e) => log.events.push({ t: performance.now(), e });
    const open = async () => {
      const s = performance.now();
      for (let delay = 100; !stopped; delay = Math.min(delay * 2, 2000)) {
        try {
          conn = await connect(transport, (why) => { if (alive && !stopped) { alive = false; ev(why); open(); } });
          conn.setOnAny((f) => { if (f.type === 'P' && !log.recv.has(f.seq)) log.recv.set(f.seq, performance.now()); });
          alive = true;
          if (log.events.length) log.reconnects.push({ start: s, ok: performance.now() });
          ev('open');
          return;
        } catch (e) {
          ev(`connect failed: ${e.message}`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    };
    open();
    timer = setInterval(() => {
      if (!alive) return;
      const i = ++seq;
      log.sent.set(i, performance.now());
      try { conn.send(frame('P', i, 64)); } catch { /* closed between checks */ }
    }, 100);
    bench.outage = {
      // true once a ping sent after t0 has been echoed
      peek(t0) { return [...log.recv.keys()].some((k) => (log.sent.get(k) ?? 0) > t0); },
      stop() {
        stopped = true;
        alive = false;
        clearInterval(timer);
        conn?.close();
        return {
          transport, events: log.events, reconnects: log.reconnects,
          sent: [...log.sent.entries()], recv: [...log.recv.entries()], now: performance.now(),
        };
      },
    };
  },
};
window.bench = bench;
