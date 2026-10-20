// P10 task 5 driver (runs in the `bench` container, see docker-compose.yml).
// Writes /results/transport.json.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const SERVER = 'wt-server';
const RUNS = Number(process.env.RUNS ?? 5);
const OUTAGE_RUNS = Number(process.env.OUTAGE_RUNS ?? 3);
const OUTAGES = (process.env.OUTAGES ?? '3000,15000,45000').split(',').map(Number);
// Client connect timeouts to compare (0 = none): a short timeout interacts
// badly with Chromium's WebTransport handshake throttling after failures.
const CONNECT_TIMEOUTS = (process.env.CONNECT_TIMEOUTS ?? '3000').split(',').map(Number);
const SKIP_PERF = Boolean(process.env.SKIP_PERF);
const SPKI = readFileSync('/certs/server.spki.b64', 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }).toString();

// Each side shapes its own egress, so one-way delay 75 ms => +150 ms RTT.
const CONDITIONS = {
  'LAN (no shaping)': { client: '', server: '', small: [20000, 64], large: [2000, 16384] },
  '4G: 150 ms RTT, 9/1.5 Mbit/s': {
    client: 'delay 75ms rate 1500kbit', server: 'delay 75ms rate 9mbit', small: [2000, 64], large: [200, 16384],
  },
  '4G + 1% loss each way': {
    client: 'delay 75ms rate 1500kbit loss 1%', server: 'delay 75ms rate 9mbit loss 1%', small: [2000, 64], large: [200, 16384],
  },
};

// serverFirst: shape the server while our own egress still works.
async function shape(c, serverFirst = false) {
  // Only port-9443 traffic is impaired (prio band 3 + u32 filter), so the
  // control channel to :9000 and ARP keep working even at "loss 100%".
  const local = () => {
    try { sh('tc', ['qdisc', 'del', 'dev', 'eth0', 'root']); } catch {}
    if (!c.client) return;
    sh('tc', ['qdisc', 'add', 'dev', 'eth0', 'root', 'handle', '1:', 'prio']);
    sh('tc', ['qdisc', 'add', 'dev', 'eth0', 'parent', '1:3', 'handle', '30:', 'netem', ...c.client.split(' ')]);
    sh('tc', ['filter', 'add', 'dev', 'eth0', 'parent', '1:0', 'protocol', 'ip', 'u32', 'match', 'ip', 'dport', '9443', '0xffff', 'flowid', '1:3']);
  };
  const remote = async () => {
    const r = await fetch(`http://${SERVER}:9000/netem?args=${encodeURIComponent(c.server)}`);
    if (!r.ok) throw new Error(`server netem: ${await r.text()}`);
    await sleep(50); // server applies 20 ms after replying
  };
  if (serverFirst) { await remote(); local(); } else { local(); await remote(); }
}

// Outage = netem "loss 100%" on both sides: packets vanish silently, like a
// real radio/link outage. (iptables DROP on OUTPUT instead makes sendmsg()
// fail with EPERM, which Chromium's QUIC treats as fatal - not realistic.)
async function blackhole(on, base) {
  const add = (a) => (on ? `${a} loss 100%`.trim() : a);
  await shape({ client: add(base.client), server: add(base.server) }, on);
}

for (let i = 0; i < 60; i++) { // wait for the server
  try { await fetch(`http://${SERVER}:9000/netem?args=`); break; } catch { await sleep(500); }
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${SPKI}`],
});
let page = await browser.newPage();
page.on('console', (m) => process.stderr.write(`[page] ${m.text()}\n`));
await page.goto(`https://${SERVER}:9443/`);
const out = {
  chromium: await browser.version(),
  supported: await page.evaluate(() => window.bench.supported()),
  runs: RUNS, outageRuns: OUTAGE_RUNS, conditions: CONDITIONS, results: [], outages: [],
};
console.error(out.chromium, out.supported);

for (const [name, c] of SKIP_PERF ? [] : Object.entries(CONDITIONS)) {
  await shape(c);
  for (let run = 1; run <= RUNS; run++) {
    for (const transport of ['webtransport', 'websocket']) {
      const r = await page.evaluate((t, o) => window.bench.run(t, o), transport, { small: c.small, large: c.large });
      out.results.push({ condition: name, run, ...r });
      console.error(`${name} | ${transport} | run ${run} | connect ${r.connectMs.toFixed(1)} rtt p50 ${r.rtt.p50.toFixed(1)}`);
    }
  }
}

// Outages on the 4G profile without loss.
const BASE = CONDITIONS['4G: 150 ms RTT, 9/1.5 Mbit/s'];
await shape(BASE);
for (const connectTimeoutMs of CONNECT_TIMEOUTS) for (let outageRun = 1; outageRun <= OUTAGE_RUNS; outageRun++) for (const outageMs of OUTAGES) {
  for (const transport of ['webtransport', 'websocket']) {
    // Fresh browser context per test so no network state carries over.
    const ctx = await browser.createBrowserContext();
    page = await ctx.newPage();
    await page.goto(`https://${SERVER}:9443/`);
    await page.evaluate((ms) => window.bench.setConnectTimeout(ms), connectTimeoutMs);
    await page.evaluate((t) => window.bench.startOutageProbe(t), transport);
    await sleep(3000);
    const dropAt = await page.evaluate(() => performance.now());
    await blackhole(true, BASE);
    await sleep(outageMs);
    await blackhole(false, BASE);
    const restoreAt = await page.evaluate(() => performance.now());
    // Wait until a ping sent after the restore has come back (or give up).
    let recovered = false;
    for (let waited = 0; waited < 180000 && !recovered; waited += 250) {
      await sleep(250);
      recovered = await page.evaluate((t0) => {
        const o = window.bench.outage; // peek without stopping
        return o && o.peek ? o.peek(t0) : false;
      }, restoreAt);
    }
    await sleep(1000);
    const log = await page.evaluate(() => window.bench.outage.stop());
    await ctx.close();
    const recv = new Map(log.recv);
    const firstAfter = Math.min(...log.recv.map(([, t]) => t).filter((t) => t > restoreAt));
    const close = log.events.find((e) => e.t > dropAt && e.e.startsWith('closed'));
    const sentDuring = log.sent.filter(([, t]) => t >= dropAt && t <= restoreAt);
    out.outages.push({
      transport, outageMs, run: outageRun, connectTimeoutMs,
      connectionClosed: Boolean(close),
      closeDetectedAfterDropMs: close ? close.t - dropAt : null,
      reconnects: log.reconnects.map((r) => ({ startAfterDropMs: r.start - dropAt, tookMs: r.ok - r.start })),
      firstMessageAfterRestoreMs: Number.isFinite(firstAfter) ? firstAfter - restoreAt : null,
      pingsSentDuringOutage: sentDuring.length,
      thoseDeliveredLater: sentDuring.filter(([s]) => recv.has(s)).length,
      totalSent: log.sent.length, totalLost: log.sent.filter(([s]) => !recv.has(s)).length,
      events: log.events.map((e) => ({ atMsFromDrop: Math.round(e.t - dropAt), e: e.e })),
    });
    console.error(`outage ${outageMs} | ${transport} | ${JSON.stringify(out.outages.at(-1)).slice(0, 300)}`);
  }
}
await shape({ client: '', server: '' });
await browser.close();
writeFileSync(SKIP_PERF ? '/results/transport-outages.json' : '/results/transport.json', JSON.stringify(out, null, 1));
console.error('wrote /results/transport.json');
