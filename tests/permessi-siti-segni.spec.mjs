// Permessi dei siti (#586): la scheda dice cosa il sito usa o si è visto negare, togliere un permesso da Sicurezza dice
// che la pagina lo tiene aperto, Sicurezza aperta in incognito mostra anche le scelte di sempre, una scheda «da un altro
// paese» in incognito non scrive su disco, a schermo intero la domanda si vede, e i caratteri del computer si possono dare.

import { test, expect } from './fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const riga = (shell) => shell.locator('#perm-bar .perm-row');

const PAGINA = `<!doctype html><html><head><title>Chiamata</title></head><body style="margin:0">
<div id="v" style="width:100%;height:100vh;background:#123"><button id="fs">schermo intero</button><button id="b">caratteri</button></div>
<script>
  document.getElementById('fs').onclick = () => document.getElementById('v').requestFullscreen();
  window.mic = () => navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { window.__s = s; return 'ok'; }, (e) => 'err:' + e.name);
  window.cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return 'ok'; }, (e) => 'err:' + e.name);
  window.chiedi = () => Notification.requestPermission();
  window.sveglio = () => navigator.wakeLock.request('screen').then(() => 'ok', (e) => 'err:' + e.name);
  window.caratteri = () => window.queryLocalFonts().then((f) => f.length, (e) => 'err:' + e.name);
</script></body></html>`;

async function avvia(page, fn) {
  await page.evaluate((f) => { window.__e = null; window[f]().then((r) => { window.__e = r; }); }, fn);
}
const esito = (page) => page.evaluate(() => window.__e);

test('la scheda dice cosa il sito usa e cosa si è visto negare; togliere da Sicurezza dice che resta acceso', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await avvia(page, 'mic');
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
  await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => esito(page)).toBe('ok');
  const segno = shell.locator('.tab.active .perm-uso');
  await expect(segno).toHaveAttribute('data-tip', /usa il microfono/);

  await avvia(page, 'cam');
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await shell.locator('#perm-bar .perm-no').click();
  await expect.poll(() => esito(page)).toBe('err:NotAllowedError');
  await expect(segno).toHaveAttribute('data-tip', /usa il microfono, non può usare la fotocamera/);
  await shell.screenshot({ path: 'tests/.shots/permessi-segno-scheda.png', clip: { x: 0, y: 0, width: 640, height: 44 } });

  const sec = await openTab('filo://security/security.html');
  const rigaMic = sec.locator('#perm-list .sn-perm-riga[data-tipo="microfono"]');
  await expect(rigaMic).toBeVisible({ timeout: 10_000 });
  await rigaMic.locator('.sn-perm-togli').click();
  await expect(rigaMic).toHaveCount(0, { timeout: 5_000 });
  await expect(shell.locator('#shell-notifs')).toContainText('resta acceso finché non la ricarichi', { timeout: 5_000 });
  expect(await page.evaluate(() => window.__s.getAudioTracks()[0].readyState), 'la pagina ce l’ha ancora: per questo lo si dice').toBe('live');
});

test('Sicurezza aperta da una finestra in incognito mostra le scelte di sempre e quelle della finestra', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(testServer.origin).host;
  await avvia(page, 'chiedi');
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
  await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => esito(page)).toBe('granted');

  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(() => { inc = app.windows().find((w) => w.url().includes('incognito=1')); return !!inc; }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  const url = testServer.html(PAGINA);
  await inc.evaluate((u) => window.filoShell.tabs.open(u), url);
  let p2 = null;
  await expect.poll(() => { p2 = app.windows().find((w) => w.url() === url); return !!p2; }).toBe(true);
  await p2.waitForFunction(() => typeof window.chiedi === 'function');
  await p2.evaluate(() => { window.__e = null; window.cam().then((r) => { window.__e = r; }); });
  await expect(inc.locator('#perm-bar .perm-no')).toBeVisible({ timeout: 10_000 });
  await inc.locator('#perm-bar .perm-no').click();
  await expect.poll(() => p2.evaluate(() => window.__e)).toBe('err:NotAllowedError');

  await inc.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  let sec = null;
  await expect.poll(() => { sec = app.windows().find((w) => w.url().startsWith('filo://security/')); return !!sec; }).toBe(true);
  await sec.waitForLoadState('domcontentloaded');
  await expect(sec.locator('#perm-list'), 'le scelte di sempre si vedono anche da qui').toContainText(host, { timeout: 5_000 });
  const inIncognito = sec.locator('#perm-list-incognito .sn-perm-riga[data-tipo="camera"]');
  await expect(inIncognito).toBeVisible();
  // Tolta da qui, la scelta dell'incognito se ne va e quella di sempre resta.
  await inIncognito.locator('.sn-perm-togli').click();
  await expect(inIncognito).toHaveCount(0);
  await expect(sec.locator('#perm-list')).toContainText(host);
});

test('in incognito una scheda «da un altro paese» tiene le risposte nella finestra, non su disco', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  // Un indirizzo spento basta: il proxy lascia passare da sé gli indirizzi locali, la pagina si carica lo stesso.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://127.0.0.1:9' } }); });
  const url = testServer.html(PAGINA);
  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(() => { inc = app.windows().find((w) => w.url().includes('incognito=1')); return !!inc; }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  await inc.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => w.url() === url), { timeout: 10_000 }).toBe(true);
  const r = await app.evaluate(async ({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.url === u);
    return w._filoTabs.setTabProxy(t.id, 'US');
  }, url);
  expect(r && r.ok).toBe(true);
  let page = null;
  await expect.poll(async () => {
    page = app.windows().filter((w) => !w.isClosed() && w.url() === url).pop();
    try { return !!page && await page.evaluate(() => typeof window.chiedi === 'function'); } catch (_) { return false; }
  }, { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => { window.__e = null; window.chiedi().then((x) => { window.__e = x; }); });
  await expect(inc.locator('#perm-bar .perm-si')).toBeEnabled({ timeout: 10_000 });
  await inc.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('granted');
  const dopo = await app.evaluate(async () => ({
    disco: (await globalThis.__filoStorage.get('sitePermissions')).sitePermissions || null,
    normale: globalThis.__filoPermessi.elenco(null),
  }));
  expect(dopo).toEqual({ disco: null, normale: [] });
  // Chiusa la finestra, la sua pagina non resta viva da nessuna parte.
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoIncognito).close(); });
  await expect.poll(() => app.evaluate(({ webContents }, u) => webContents.getAllWebContents().filter((w) => w.getURL() === u).length, url)).toBe(0);
});

test('a schermo intero una domanda riporta la cornice, così si vede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const stato = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { fs: tm.contentFullscreen, y: t.view.getBounds().y };
  });
  await page.click('#fs');
  await expect.poll(async () => (await stato()).fs).toBe(true);
  await avvia(page, 'chiedi');
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect.poll(async () => (await stato()).fs).toBe(false);
  const bar = await shell.locator('#perm-bar').boundingBox();
  expect((await stato()).y).toBeGreaterThanOrEqual(Math.floor(bar.y + bar.height));
});

test('tenere acceso lo schermo non si chiede; i caratteri del computer si danno dal segno sulla scheda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#b');
  expect(await page.evaluate(() => window.sveglio())).toBe('ok');
  await expect(riga(shell)).toHaveCount(0);
  await page.click('#b');
  expect(await page.evaluate(() => window.caratteri()), 'senza un sì il sito non li vede').toBe(0);
  const segno = shell.locator('.tab.active .perm-uso.bloccato');
  await expect(segno).toHaveAttribute('data-tip', /vorrebbe vedere i caratteri del computer/);
  // Il segno apre i permessi della scheda, con la voce per dire sì.
  await segno.click();
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try {
        const ok = await w.evaluate(() => {
          const b = [...document.querySelectorAll('button.item')].find((x) => /^Consenti caratteri del computer$/.test(x.textContent.trim()));
          if (!b) return false;
          b.click();
          return true;
        });
        if (ok) return true;
      } catch (_) {}
    }
    return false;
  }, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => app.evaluate((_e, o) => (globalThis.__filoPermessi.elenco(null).find((x) => x.origine === o) || { scelte: {} }).scelte.caratteri, testServer.origin)).toBe('consenti');
  await page.click('#b');
  const n = await page.evaluate(() => window.caratteri());
  expect(typeof n === 'number' && n >= 0, `dopo il sì il sito legge l’elenco (${n})`).toBe(true);
  await expect(shell.locator('.tab.active .perm-uso')).toHaveCount(0);
});
