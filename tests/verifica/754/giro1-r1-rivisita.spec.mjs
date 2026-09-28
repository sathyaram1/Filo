// #754 giro 1, rilievo 1: dove Filo ha rifiutato, il sito si ricorda il rifiuto e non mostra più il banner.
// Tornandoci in una scheda nuova, o dopo aver riaperto Filo, il menu della scheda deve ancora dire cosa è
// successo e offrire «Mostra il banner dei cookie»: è lì che l'utente lo cerca quando un contenuto non va.
import { test as base, _electron as electron, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Banner nella forma OneTrust: il sito se lo ricorda con un suo cookie e alla visita dopo non lo mostra.
const PAGE = (title) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>
<p>Articolo con un video incorporato.</p>
<script>
window.__r = '';
if (!document.cookie.includes('OptanonAlertBoxClosed')) document.write(
  '<div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:20px;z-index:9">Usiamo i cookie. ' +
  '<button id="onetrust-reject-all-handler" onclick="window.__r=\\'reject\\';document.cookie=\\'OptanonAlertBoxClosed=1; path=/; max-age=31536000\\';this.parentNode.remove()">Rifiuta tutto</button> ' +
  '<button id="onetrust-accept-btn-handler" onclick="window.__r=\\'accept\\';document.cookie=\\'OptanonAlertBoxClosed=1; path=/; max-age=31536000\\';this.parentNode.remove()">Accetta</button></div>');
</script></body></html>`;

const test = base.extend({
  srv: async ({}, use) => {
    const server = createServer((req, res) => {
      const path = req.url.split('?')[0];
      if (path !== '/a' && path !== '/b') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE(path === '/a' ? 'ARTICOLO_A' : 'ARTICOLO_B'));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    await use({ url: (p) => `http://giornale.test:${port}${p}` });
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  },
  userData: async ({}, use) => {
    const dir = cartellaTemporanea('filo-test-');
    await use(dir);
    try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  },
});

async function avvia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '--host-resolver-rules=MAP *.test 127.0.0.1', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
  });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

async function apri(app, shell, url, title) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (w.url() === url || (await w.title()) === title) { page = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  return page;
}

async function rightClickTab(shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  });
}

async function menuDellaScheda(app, shell) {
  let text = null;
  await expect.poll(async () => {
    await rightClickTab(shell);
    await sleep(200);
    for (const w of app.windows()) {
      try {
        const t = await w.evaluate(() => (document.body && document.body.innerText.includes('Duplica')) ? document.body.innerText : null);
        if (t != null) { text = t; return true; }
      } catch (_) {}
    }
    return false;
  }, { timeout: 15_000 }).toBe(true);
  return text;
}

async function rifiutaSuA(app, shell, srv) {
  const a = await apri(app, shell, srv.url('/a'), 'ARTICOLO_A');
  await expect.poll(() => a.evaluate(() => window.__r).catch(() => ''), { timeout: 15_000 }).toBe('reject');
  // Qui, nella scheda dove è successo, il segno c'è.
  expect(await menuDellaScheda(app, shell)).toContain('Mostra il banner dei cookie');
  return a;
}

test('in una scheda nuova dello stesso sito il menu offre ancora «Mostra il banner dei cookie»', async ({ srv, userData }) => {
  const { app, shell } = await avvia(userData);
  try {
    await rifiutaSuA(app, shell, srv);
    const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    const tabA = snap.tabs.find((t) => /giornale\.test/.test(t.url));
    await shell.evaluate((id) => window.filoShell.tabs.close(id), tabA.id);
    await shell.keyboard.press('Escape').catch(() => {});
    const b = await apri(app, shell, srv.url('/b'), 'ARTICOLO_B');
    await sleep(3000);
    // Il sito si ricorda il rifiuto: niente banner. Proprio per questo il menu deve dirlo e offrire di rivederlo.
    expect(await b.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(false);
    expect(await menuDellaScheda(app, shell)).toContain('Mostra il banner dei cookie');
  } finally {
    await chiudiApp(app);
  }
});

test('dopo aver riaperto Filo il menu della scheda offre ancora «Mostra il banner dei cookie»', async ({ srv, userData }) => {
  let { app, shell } = await avvia(userData);
  try {
    await rifiutaSuA(app, shell, srv);
    await sleep(1500);
  } finally {
    await chiudiApp(app);
  }
  ({ app, shell } = await avvia(userData));
  try {
    const b = await apri(app, shell, srv.url('/b'), 'ARTICOLO_B');
    await sleep(3000);
    expect(await b.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(false);
    expect(await menuDellaScheda(app, shell)).toContain('Mostra il banner dei cookie');
  } finally {
    await chiudiApp(app);
  }
});
