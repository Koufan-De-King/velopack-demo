// P10 task 2: JS vs Wasm loading benchmarks.
//   RUNS=3 node bench.mjs > ../results/bench.json
//
// Metrics (ms from navigation start):
//   ttfb        navigation responseStart (time to first response byte)
//   fcp         first-contentful-paint (first canvas paint)
//   firstFrame  `flutter-first-frame` mark set by the app's first post-frame callback
//   tti         first frame, or the end of the last long task after it once the
//               main thread has been quiet for QUIET_MS (Lighthouse-style)
//   loaded      last network response end (everything the app fetched)
//   bytes       encoded bytes over the wire incl. headers (CDP), requests = count
//   tbt         total blocking time (sum of long-task time over 50 ms) until tti
//   longest     longest main-thread task (jank indicator)
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Trust the local self-signed key (no certificate error, so caching works).
const SPKI = readFileSync(new URL('../deploy/certs/localhost.spki.b64', import.meta.url), 'utf8').trim();
const RUNS = Number(process.env.RUNS ?? 3);
const QUIET_MS = 2000;

const BUILDS = {
  js: 'https://localhost:8444/',
  wasm: 'https://localhost:8443/',
  'wasm-single-thread': 'https://localhost:8445/',
};
const MBPS = (n) => (n * 1000 * 1000) / 8;
const PROFILES = {
  'desktop, unthrottled': { cpu: 1, net: null, mobile: false },
  'desktop, 4G': { cpu: 1, net: { latency: 150, down: MBPS(9), up: MBPS(1.5) }, mobile: false },
  'mobile 4x CPU, 4G': { cpu: 4, net: { latency: 150, down: MBPS(9), up: MBPS(1.5) }, mobile: true },
  'mobile 4x CPU, slow 4G': { cpu: 4, net: { latency: 562.5, down: MBPS(1.44), up: MBPS(0.675) }, mobile: true },
};
const only = (env, all) => (process.env[env] ? process.env[env].split('|') : Object.keys(all));
const builds = only('BUILDS', BUILDS);
const profiles = only('PROFILES', PROFILES);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADFUL ? false : 'new',
  args: [`--ignore-certificate-errors-spki-list=${SPKI}`, '--disable-features=Translate', '--no-first-run'],
});
const chromeVersion = await browser.version();

async function load(page, cdp, url) {
  const bytes = new Map();
  const onFinished = (e) => bytes.set(e.requestId, e.encodedDataLength);
  cdp.on('Network.loadingFinished', onFinished);
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => performance.getEntriesByName('flutter-first-frame').length > 0,
    { timeout: 120000, polling: 50 });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 120000 });
  const m = await page.evaluate(async (quietMs) => {
    const ff = performance.getEntriesByName('flutter-first-frame')[0].startTime;
    // Wait until no long task has ended for quietMs.
    for (;;) {
      const last = Math.max(ff, ...window.__longTasks.map((t) => t.startTime + t.duration));
      if (performance.now() - last >= quietMs) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    const tti = Math.max(ff, ...window.__longTasks.map((t) => t.startTime + t.duration));
    const lt = window.__longTasks.filter((t) => t.startTime < tti);
    return {
      ttfb: nav.responseStart,
      fcp,
      firstFrame: ff,
      tti,
      loaded: Math.max(nav.loadEventEnd, ...res.map((r) => r.responseEnd)),
      tbt: lt.reduce((s, t) => s + Math.max(0, t.duration - 50), 0),
      longest: Math.max(0, ...window.__longTasks.map((t) => t.duration)),
      longTasks: lt.length,
      revalidated: res.filter((r) => r.transferSize > 0 && r.transferSize < 1000 && r.decodedBodySize > 1000).length,
    };
  }, QUIET_MS);
  cdp.off('Network.loadingFinished', onFinished);
  m.bytes = [...bytes.values()].reduce((a, b) => a + b, 0);
  m.requests = bytes.size;
  return m;
}

async function newPage(ctx, profile) {
  const page = await ctx.newPage();
  const p = PROFILES[profile];
  if (p.mobile) {
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  } else {
    await page.setViewport({ width: 1280, height: 800 });
  }
  await page.evaluateOnNewDocument(() => {
    window.__longTasks = [];
    new PerformanceObserver((l) => window.__longTasks.push(...l.getEntries().map((e) => ({ startTime: e.startTime, duration: e.duration }))))
      .observe({ type: 'longtask', buffered: true });
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  if (p.net) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: p.net.latency, downloadThroughput: p.net.down, uploadThroughput: p.net.up,
    });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  return { page, cdp };
}

const rows = [];
for (const profile of profiles) {
  for (let run = 1; run <= RUNS; run++) {
    for (const build of builds) { // interleave builds to spread out drift
      const url = BUILDS[build];
      const ctx = await browser.createBrowserContext(); // empty HTTP cache
      const { page, cdp } = await newPage(ctx, profile);
      const cold = await load(page, cdp, url);
      rows.push({ build, profile, cache: 'cold', run, ...cold });
      // Warm: same context (cache populated by the cold load), fresh tab.
      await page.close();
      const warmTab = await newPage(ctx, profile);
      const warm = await load(warmTab.page, warmTab.cdp, url);
      rows.push({ build, profile, cache: 'warm', run, ...warm });
      if (run === 1 && !rows.some((r) => r.gl)) {
        rows.at(-1).gl = await warmTab.page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl2');
          const ext = gl?.getExtension('WEBGL_debug_renderer_info');
          return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'no webgl2';
        });
      }
      await ctx.close();
      process.stderr.write(`${profile} | ${build} | run ${run} | cold ff=${cold.firstFrame.toFixed(0)} warm ff=${warm.firstFrame.toFixed(0)}\n`);
    }
  }
}
await browser.close();
console.log(JSON.stringify({ chrome: chromeVersion, runs: RUNS, profiles: PROFILES, rows }, null, 1));
