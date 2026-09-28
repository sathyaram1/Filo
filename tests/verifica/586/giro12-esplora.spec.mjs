// Verifica #586 giro 12: esplorazione delle porte (si rinomina per rilievo prima di registrare).
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA_FURBA = `<!doctype html><html><head><title>Furba</title></head><body>
<input id="campo" style="width:300px">
<script>
  const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
  async function premiNelMenu(sel, testo) {
    const c = document.getElementById('campo');
    c.focus();
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 5, clientY: r.top + 5 }));
    for (let i = 0; i < 60; i++) {
      await attendi(50);
      const b = [...document.querySelectorAll(sel)].find((x) => !testo || x.textContent.includes(testo));
      if (b) { b.click(); return true; }
    }
    return false;
  }
  window.rubaAppunti = async () => {
    const premuto = await premiNelMenu('.sn-menu .sn-menu-paste-main');
    let mio = null;
    const fine = Date.now() + 2500;
    while (Date.now() < fine && mio == null) {
      navigator.clipboard.readText().then((t) => { if (mio == null) mio = t; }, () => {});
      await attendi(15);
    }
    await attendi(500);
    return { premuto, campo: document.getElementById('campo').value, mio };
  };
  window.rubaMicrofono = async () => {
    const premuto = await premiNelMenu('.sn-menu .sn-menu-split-main', 'Detta');
    let traccia = null;
    const fine = Date.now() + 2500;
    while (Date.now() < fine && !traccia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { if (!traccia) { traccia = s; window.__tieni = s; } }, () => {});
      await attendi(15);
    }
    await attendi(300);
    return { premuto, microfono: traccia ? traccia.getAudioTracks().map((t) => t.readyState).join(',') : null };
  };
</script></body></html>`;

test('esplora: la pagina preme Incolla e Detta nel menu di Filo al posto dell’utente', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('codice-segreto-586'));
  const page = await testServer.openReady(openTab, PAGINA_FURBA);
  const appunti = await page.evaluate(() => window.rubaAppunti());
  console.log('APPUNTI', JSON.stringify(appunti), 'righe', await riga(shell).count());
  await page.keyboard.press('Escape').catch(() => {});
  const page2 = await testServer.openReady(openTab, PAGINA_FURBA);
  const mic = await page2.evaluate(() => window.rubaMicrofono());
  console.log('MICROFONO', JSON.stringify(mic), 'righe', await riga(shell).count());
  console.log('ELENCO', JSON.stringify(await app.evaluate(() => globalThis.__filoPermessi.elenco(null))));
});

const PAGINA_ASPETTA = `<!doctype html><html><head><title>Aspetta</title></head><body>
<input id="campo" style="width:300px">
<script>
  window.__preso = null;
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    const fine = Date.now() + 5000;
    const giro = () => {
      if (window.__preso != null || Date.now() > fine) return;
      navigator.clipboard.readText().then((t) => { if (window.__preso == null) window.__preso = t; }, () => {});
      setTimeout(giro, 10);
    };
    giro();
  }, true);
</script></body></html>`;

test('esplora: l’utente usa Incolla di Filo su un sito che aspetta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-di-mario'));
  const page = await testServer.openReady(openTab, PAGINA_ASPETTA);
  await page.locator('#campo').click();
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect(page.locator('#campo')).toHaveValue('password-di-mario', { timeout: 5_000 });
  await sleep(800);
  console.log('SITO', JSON.stringify(await page.evaluate(() => window.__preso)), 'righe', await riga(shell).count());
});

const PAGINA_SCHERMO = `<!doctype html><html><head><title>Schermo</title></head><body>
<script>
  window.vecchia = (audio) => navigator.mediaDevices.getUserMedia({
    audio: audio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then((s) => { window.__s = s; return s.getTracks().map((t) => t.kind + ':' + t.label + ':' + t.readyState); }, (e) => 'err:' + e.name + ':' + e.message);
  window.moderna = () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    .then((s) => { window.__m = s; return s.getTracks().map((t) => t.kind + ':' + t.label); }, (e) => 'err:' + e.name);
  window.insisti = () => { window.__n = 0; setInterval(() => { window.__n++; navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } } }).catch(() => {}); }, 300); };
  window.insistiCamera = () => { setInterval(() => { navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {}); }, 100); };
</script></body></html>`;

test('esplora: la strada vecchia dello schermo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA_SCHERMO);
  await page.evaluate(() => { window.__e = null; window.vecchia(true).then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  console.log('DOMANDA', await riga(shell).innerText());
  const si = shell.locator('#perm-bar .perm-si');
  await expect(si).toBeEnabled();
  await si.click();
  await expect.poll(() => page.evaluate(() => window.__e), { timeout: 10_000 }).not.toBeNull();
  console.log('VECCHIA', JSON.stringify(await page.evaluate(() => window.__e)), 'righe', await riga(shell).count());
  await page.evaluate(() => { try { window.__s.getTracks().forEach((t) => t.stop()); } catch (_) {} });

  // Nega sullo schermo: la strada vecchia parte senza gesto e torna a chiedere.
  await page.evaluate(() => window.insisti());
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  let tornate = 0;
  for (let i = 0; i < 3; i++) {
    await expect(shell.locator('#perm-bar .perm-no')).toBeEnabled();
    await shell.locator('#perm-bar .perm-no').click();
    await sleep(700);
    if (await riga(shell).count()) tornate++;
  }
  console.log('NEGA SCHERMO, tornata', tornate, 'su 3');
});

test('esplora: la × su un sito che insiste', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA_SCHERMO);
  await page.evaluate(() => window.insistiCamera());
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  let tornate = 0;
  for (let i = 0; i < 4; i++) {
    await shell.locator('#perm-bar .perm-chiudi').click();
    await sleep(500);
    if (await riga(shell).count()) tornate++;
  }
  console.log('X CAMERA, tornata', tornate, 'su 4');
  await page.keyboard.press('Escape');
  await sleep(300);
  console.log('ESC, righe', await riga(shell).count());
});

const PAGINA_ALTRO = `<!doctype html><html><head><title>Altro</title></head><body>
<button id="b">prova</button>
<script>
  window.__r = {};
  window.statoIniziale = async () => {
    const out = { notif: Notification.permission };
    for (const n of ['camera', 'microphone', 'geolocation', 'notifications']) {
      try { out[n] = (await navigator.permissions.query({ name: n })).state; } catch (e) { out[n] = 'err'; }
    }
    return out;
  };
  window.wake = () => navigator.wakeLock.request('screen').then(() => 'ok', (e) => 'err:' + e.name);
  window.persist = () => navigator.storage.persist().then((x) => 'persist:' + x, (e) => 'err:' + e.name);
  window.fonts = () => (window.queryLocalFonts ? window.queryLocalFonts().then((f) => 'fonts:' + f.length, (e) => 'err:' + e.name) : Promise.resolve('nofn'));
</script></body></html>`;

test('esplora: permessi che nessun browser chiede, e caratteri', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA_ALTRO);
  console.log('INIZIALE', JSON.stringify(await page.evaluate(() => window.statoIniziale())));
  await page.click('#b');
  console.log('FONTS prima', await page.evaluate(() => window.fonts()));
  await page.evaluate(() => { window.__w = null; window.wake().then((r) => { window.__w = r; }); });
  await sleep(1500);
  console.log('WAKE righe', await riga(shell).count(), (await riga(shell).count()) ? await riga(shell).first().innerText() : '', await page.evaluate(() => window.__w));
  if (await riga(shell).count()) {
    await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
    await shell.locator('#perm-bar .perm-si').click();
    await sleep(500);
    console.log('WAKE dopo consenti', await page.evaluate(() => window.__w));
  }
  await page.click('#b');
  console.log('FONTS dopo', await page.evaluate(() => window.fonts()));
  await page.evaluate(() => { window.__p = null; window.persist().then((r) => { window.__p = r; }); });
  await sleep(1500);
  console.log('PERSIST righe', await riga(shell).count(), await page.evaluate(() => window.__p));
  console.log('ELENCO', JSON.stringify(await app.evaluate(() => globalThis.__filoPermessi.elenco(null))));
});
