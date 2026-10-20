// P10 task 4: verify cross-origin isolation, SharedArrayBuffer, Wasm (not JS
// fallback), multithreaded skwasm and font loading for each server variant.
//   node verify.mjs > ../results/verify.json
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Trust the local self-signed key (no certificate error, so caching works).
const SPKI = readFileSync(new URL('../deploy/certs/localhost.spki.b64', import.meta.url), 'utf8').trim();
const VARIANTS = [
  { name: 'wasm + COOP/COEP credentialless', url: 'https://localhost:8443/' },
  { name: 'js + COOP/COEP credentialless', url: 'https://localhost:8444/' },
  { name: 'wasm, no isolation headers', url: 'https://localhost:8445/' },
  { name: 'wasm + COOP/COEP require-corp', url: 'https://localhost:8446/' },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADFUL ? false : 'new',
  args: [`--ignore-certificate-errors-spki-list=${SPKI}`, '--enable-unsafe-swiftshader'],
});

const results = [];
for (const v of VARIANTS) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text().split('\n')[0]}`));
  const failed = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  const blocked = [];
  page.on('response', (r) => { if (r.status() >= 400) blocked.push(`${r.status()} ${r.url()}`); });

  await page.goto(v.url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(
    () => performance.getEntriesByName('flutter-first-frame').length > 0,
    { timeout: 30000 },
  ).catch(() => {});

  await new Promise((r) => setTimeout(r, 1000));
  const workers = page.workers().map((w) => w.url());
  const info = await page.evaluate(async () => {
    await document.fonts.ready;
    const res = performance.getEntriesByType('resource');
    return {
      crossOriginIsolated: self.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
      firstFrameMark: performance.getEntriesByName('flutter-first-frame').length > 0,
      appCode: res.map((r) => r.name).filter((n) => /main\.dart\.(js|mjs|wasm)$/.test(n))
        .map((n) => n.split('/').pop()),
      renderer: res.map((r) => r.name).filter((n) => /canvaskit|skwasm|wimp|webparagraph/.test(n)),
      externalResources: res.filter((r) => !r.name.startsWith(location.origin))
        .map((r) => ({ url: r.name, status: r.responseStatus, bytes: r.transferSize })),
      fontRequests: res.filter((r) => /\.(woff2?|ttf|otf)$/.test(r.name))
        .map((r) => `${r.responseStatus} ${r.name}`),
      protocols: [...new Set(res.map((r) => r.nextHopProtocol))],
    };
  });
  const runtimeLine = consoleLines.find((l) => l.includes('p10-runtime:'));
  const png = `../results/screenshot-${v.url.split(':')[2].replace('/', '')}.png`;
  await page.screenshot({ path: png });
  results.push({
    ...v, ...info, runtime: runtimeLine?.split('p10-runtime: ')[1] ?? null,
    workers, multithreaded: workers.length > 0,
    consoleWarnings: consoleLines.filter((l) => !l.startsWith('[info]')),
    failedRequests: failed, httpErrors: blocked, screenshot: png,
  });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ chrome: CHROME, results }, null, 1));
