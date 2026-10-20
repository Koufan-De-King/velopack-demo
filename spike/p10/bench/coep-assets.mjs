// P10 task 4: which third-party resources survive each COEP mode?
//   node coep-assets.mjs > ../results/coep-assets.json
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Trust the local self-signed key (no certificate error, so caching works).
const SPKI = readFileSync(new URL('../deploy/certs/localhost.spki.b64', import.meta.url), 'utf8').trim();
const VARIANTS = [
  { name: 'no isolation headers', url: 'https://localhost:8445/' },
  { name: 'COEP credentialless', url: 'https://localhost:8443/' },
  { name: 'COEP require-corp', url: 'https://localhost:8446/' },
];
const IMG_NO_CORP = 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png';
const IMG_WITH_CORP = 'https://avatars.githubusercontent.com/u/9919?v=4';
const FONT = 'https://fonts.gstatic.com/s/roboto/v32/KFOmCnqEu92Fr1Me4GZLCzYlKw.woff2';
const IFRAME = 'https://example.com/';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: [`--ignore-certificate-errors-spki-list=${SPKI}`],
});
const out = [];
for (const v of VARIANTS) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const blocked = [];
  page.on('requestfailed', (r) => blocked.push(`${r.failure()?.errorText} ${r.url()}`));
  await page.goto(v.url, { waitUntil: 'networkidle0' });
  const r = await page.evaluate(async (a) => {
    const img = (src, cors) => new Promise((res) => {
      const i = new Image();
      if (cors) i.crossOrigin = 'anonymous';
      i.onload = () => res('loaded');
      i.onerror = () => res('blocked/error');
      i.src = src + (src.includes('?') ? '&' : '?') + 'n=' + Math.random();
    });
    const font = async () => {
      try { await new FontFace('T', `url(${a.FONT})`).load(); return 'loaded'; } catch (e) { return 'error: ' + e.message; }
    };
    const fetchCors = async (u) => {
      try { const x = await fetch(u, { mode: 'cors' }); return `${x.status}`; } catch (e) { return 'error'; }
    };
    const iframe = () => new Promise((res) => {
      const f = document.createElement('iframe');
      f.src = a.IFRAME;
      f.onload = () => res('load event');
      document.body.appendChild(f);
      setTimeout(() => res('timeout'), 8000);
    });
    const popup = async () => {
      const w = window.open(a.IFRAME, '_blank', 'popup,width=400,height=300');
      if (!w) return 'window.open returned null';
      await new Promise((r) => setTimeout(r, 3000));
      const s = `handle.closed=${w.closed}`;
      try { w.close(); } catch {}
      return s;
    };
    return {
      crossOriginIsolated: self.crossOriginIsolated,
      'img no-cors, no CORP header (Wikimedia)': await img(a.IMG_NO_CORP, false),
      'img crossorigin=anonymous, no CORP (Wikimedia)': await img(a.IMG_NO_CORP, true),
      'img no-cors, CORP: cross-origin (GitHub avatar)': await img(a.IMG_WITH_CORP, false),
      'web font from fonts.gstatic.com': await font(),
      'fetch() CORS (Wikimedia)': await fetchCors(a.IMG_NO_CORP),
      'cross-origin iframe without COEP (example.com)': await iframe(),
      'cross-origin popup (window.open)': await popup(),
    };
  }, { IMG_NO_CORP, IMG_WITH_CORP, FONT, IFRAME });
  out.push({ ...v, ...r, blockedRequests: blocked.filter((b) => !b.includes('ERR_ABORTED')) });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
