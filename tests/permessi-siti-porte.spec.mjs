// Permessi dei siti (#586), le porte che il sito si apre da sé: i bottoni del menu di Filo spostati, staccati,
// coperti o portati sotto il cursore non rispondono; la strada vecchia per lo schermo non passa né con una richiesta
// che cambia mentre la si legge né da un riquadro vuoto, e se passa la pagina si chiude prima di riceverla; le
// notifiche un riquadro di un altro sito non le chiede e non le eredita.

import { test, expect } from './fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const riga = (shell) => shell.locator('#perm-bar .perm-row');

// Appena il menu di Filo compare (dopo un tasto destro vero), la pagina fa `window.__modo` al suo bottone.
const MENU_OSTILE = `<!doctype html><html><head><title>Ostile</title></head><body>
<input id="campo" style="width:300px"><div id="via" style="position:fixed;left:400px;top:300px"></div>
<script>
  window.__modo = '';
  window.__fatto = false;
  const trova = (m) => {
    if (window.__modo === 'detta') return [...m.querySelectorAll('.sn-menu-split-main')].find((x) => x.textContent.includes('Detta'));
    if (window.__modo === 'storia') return m.querySelector('.sn-menu-paste-arrow');
    return m.querySelector('.sn-menu-paste-main');
  };
  new MutationObserver(() => {
    const m = document.querySelector('.sn-menu');
    if (!m || !window.__modo || window.__fatto) return;
    const b = trova(m);
    if (!b) return;
    window.__fatto = true;
    document.getElementById('campo').focus();
    if (window.__modo === 'stacca') { b.remove(); b.click(); }
    else if (window.__modo === 'copri') {
      const velo = document.createElement('div');
      velo.popover = 'manual';
      velo.style.cssText = 'position:fixed;inset:0;margin:0;border:0;width:100vw;height:100vh;background:#fff;pointer-events:none';
      document.body.appendChild(velo);
      velo.showPopover();
    } else if (window.__modo === 'sposta-menu') {
      m.style.left = '420px';
      m.style.top = '320px';
    } else { document.getElementById('via').appendChild(b); b.click(); }
  }).observe(document.documentElement, { childList: true, subtree: true });
</script></body></html>`;

async function apriOstile(app, openTab, testServer, modo) {
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-586'));
  const page = await testServer.openReady(openTab, MENU_OSTILE);
  await page.evaluate((m) => { window.__modo = m; }, modo);
  await page.locator('#campo').click({ button: 'right' });
  await sleep(600);
  return page;
}

for (const modo of ['sposta', 'stacca']) {
  test(`un bottone del menu che la pagina ${modo === 'sposta' ? 'porta fuori' : 'stacca'} e preme non incolla niente`, async ({ app, openTab, testServer }) => {
    const page = await apriOstile(app, openTab, testServer, modo);
    await sleep(800);
    expect(await page.locator('#campo').inputValue()).not.toContain('password-586');
  });
}

test('la pagina non fa partire Detta né apre la cronologia premendo i bottoni che ha spostato', async ({ app, openTab, testServer }) => {
  const page = await apriOstile(app, openTab, testServer, 'detta');
  await sleep(800);
  await expect(page.locator('.sn-dictate-pill')).toHaveCount(0);
  const storia = await apriOstile(app, openTab, testServer, 'storia');
  await sleep(800);
  expect(await storia.evaluate(() => document.querySelectorAll('.sn-menu-history-item').length)).toBe(0);
});

test('un clic vero su Incolla non incolla se la pagina copre il menu o lo porta sotto il cursore', async ({ app, openTab, testServer }) => {
  for (const modo of ['copri', 'sposta-menu']) {
    const page = await apriOstile(app, openTab, testServer, modo);
    await page.locator('.sn-menu .sn-menu-paste-main').click({ force: true });
    await sleep(600);
    expect(await page.locator('#campo').inputValue(), modo).not.toContain('password-586');
  }
  // Lo stesso clic sul menu com'è stato disegnato incolla.
  const page = await apriOstile(app, openTab, testServer, '');
  await page.locator('.sn-menu .sn-menu-paste-main').click();
  await expect(page.locator('#campo')).toHaveValue('password-586');
});

const SCHERMO_VECCHIO = `<!doctype html><html><head><title>Vecchia</title></head><body>
<textarea id="campo"></textarea>
<script>
  const desktop = { mandatory: { chromeMediaSource: 'desktop' } };
  const tracce = (s) => s.getTracks().map((t) => t.kind + ':' + t.label);
  // Vuota la prima volta che la si legge, con la fonte vecchia dalla seconda.
  const cambia = () => { let n = 0; return { get mandatory() { return n++ ? { chromeMediaSource: 'desktop' } : {}; } }; };
  // La funzione intatta di un riquadro vuoto, preso per numero: lì Filo non arriva prima della pagina.
  const intonsa = () => { document.body.appendChild(document.createElement('iframe')); return window[window.length - 1].MediaDevices.prototype.getUserMedia; };
  const esito = (p) => p.then((s) => { window.__s = s; return tracce(s); }, (e) => 'err:' + e.name);
  window.cambia = () => esito(navigator.mediaDevices.getUserMedia({ audio: cambia(), video: cambia() }));
  window.riquadro = () => esito(intonsa().call(navigator.mediaDevices, { audio: desktop, video: desktop }));
  window.annunciata = () => { document.dispatchEvent(new Event('__filo_schermo_annunciato')); return window.riquadro(); };
</script></body></html>`;

test('la strada vecchia per lo schermo non passa né con una richiesta che cambia né da un riquadro vuoto', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, SCHERMO_VECCHIO);
  let morta = false;
  page.on('crash', () => { morta = true; });
  expect(await page.evaluate(() => window.cambia())).toBe('err:NotAllowedError');
  expect(await page.evaluate(() => window.riquadro())).toBe('err:NotAllowedError');
  await sleep(500);
  await expect(riga(shell)).toHaveCount(0);
  expect(morta).toBe(false);
});

test('se la strada vecchia arriva fino al sì, la pagina si chiude prima di ricevere lo schermo e dice perché', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, SCHERMO_VECCHIO);
  page.evaluate(() => { window.annunciata().then((r) => { window.__e = r; }); }).catch(() => {});
  await expect(riga(shell)).toContainText('vuole vedere il tuo schermo', { timeout: 10_000 });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
  await shell.locator('#perm-bar .perm-si').click();
  await shell.locator('#perm-bar .perm-fonte[data-tipo="scheda"]').first().click();
  const indirizzo = () => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    return t ? t.view.webContents.getURL() : '';
  });
  await expect.poll(indirizzo, { timeout: 10_000 }).toContain('desc=filo-schermo');
});

test('un riquadro di un altro sito non chiede le notifiche col nome di chi lo ospita, e non eredita il suo sì', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const dentro = testServer.html(`<!doctype html><title>Pubblicita</title><script>
    window.addEventListener('message', async (e) => {
      if (e.data !== 'chiedi') return;
      const prima = Notification.permission;
      const r = await Notification.requestPermission();
      parent.postMessage({ prima, r }, '*');
    });
  </script>`).replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><title>Giornale</title>
    <iframe id="f" src="${dentro}" width="300" height="100"></iframe>
    <script>
      window.__r = null;
      window.addEventListener('message', (e) => { if (e.data && e.data.r) window.__r = e.data; });
      window.chiediMia = () => Notification.requestPermission().then((r) => { window.__mia = r; });
      window.chiediRiquadro = () => document.getElementById('f').contentWindow.postMessage('chiedi', '*');
    </script>`);
  await sleep(1000);
  await page.evaluate(() => window.chiediRiquadro());
  await expect.poll(() => page.evaluate(() => window.__r), { timeout: 5000 }).toEqual({ prima: 'denied', r: 'denied' });
  await expect(riga(shell)).toHaveCount(0);
  await page.evaluate(() => { window.__r = null; window.chiediMia(); });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled({ timeout: 10_000 });
  await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__mia), { timeout: 5000 }).toBe('granted');
  await page.evaluate(() => window.chiediRiquadro());
  await expect.poll(() => page.evaluate(() => window.__r), { timeout: 5000 }).toEqual({ prima: 'denied', r: 'denied' });
});
