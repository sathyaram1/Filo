// Verifica #586 giro 14: esplorazione 2 (si cancella o si rinomina prima della registrazione).
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LEGACY = `<!doctype html><html><head><title>Esplora</title></head><body>
<script>
  const desktop = { mandatory: { chromeMediaSource: 'desktop' } };
  const tracce = (s) => s.getTracks().map((t) => t.kind + ':' + t.label + ':' + t.readyState);
  window.indiceSchermoEAudio = () => {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    const gum = window[0].MediaDevices.prototype.getUserMedia;
    return gum.call(navigator.mediaDevices, { audio: desktop, video: desktop })
      .then((s) => { window.__s = s; return tracce(s); }, (e) => 'err:' + e.name + ':' + e.message);
  };
  window.soloOrientamento = () => { window.addEventListener('deviceorientation', () => {}); return 'ok'; };
</script></body></html>`;

test('F: strada vecchia per indice, scelta «questa scheda»', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, LEGACY);
  await page.evaluate(() => { window.__e = null; window.indiceSchermoEAudio().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
  await shell.locator('#perm-bar .perm-si').click();
  await expect(shell.locator('#perm-bar .perm-fonte[data-tipo="scheda"]').first()).toBeVisible({ timeout: 10_000 });
  await shell.locator('#perm-bar .perm-fonte[data-tipo="scheda"]').first().click();
  await expect.poll(() => page.evaluate(() => window.__e), { timeout: 10_000 }).not.toBeNull();
  console.log('F esito', JSON.stringify(await page.evaluate(() => window.__e)));
  const v = await page.evaluate(() => { const t = window.__s && window.__s.getVideoTracks()[0]; return t ? t.getSettings() : null; });
  console.log('F impostazioni video', JSON.stringify(v));
});

test('G: solo un ascoltatore dell’orientamento', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, LEGACY);
  await page.evaluate(() => window.soloOrientamento());
  await sleep(2500);
  console.log('G domande', await riga(shell).count(), JSON.stringify(await shell.locator('#perm-bar').innerText().catch(() => '')));
});

const SPOSTA = `<!doctype html><html><head><title>Sposta</title></head><body>
<input id="campo" style="width:300px"><div id="nascondi" style="position:fixed;left:-9999px"></div>
<script>
  window.__modo = '';
  window.__log = [];
  new MutationObserver(() => {
    const m = document.querySelector('.sn-menu');
    if (!m || !window.__modo || window.__fatto) return;
    let b = null;
    if (window.__modo === 'incolla') b = m.querySelector('.sn-menu-paste-main');
    if (window.__modo === 'detta') b = [...m.querySelectorAll('.sn-menu-split-main')].find((x) => x.textContent.includes('Detta'));
    if (window.__modo === 'storia') b = m.querySelector('.sn-menu-paste-arrow');
    if (!b) return;
    window.__fatto = true;
    document.getElementById('campo').focus();
    document.getElementById('nascondi').appendChild(b);
    b.click();
    if (window.__modo === 'storia') b.dispatchEvent(new MouseEvent('mouseenter'));
    setTimeout(() => {
      window.__storia = [...document.querySelectorAll('.sn-menu-history-item')].map((r) => r.dataset.snSearch);
    }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });
</script></body></html>`;

for (const modo of ['incolla', 'detta', 'storia']) {
  test(`H: la pagina sposta il bottone «${modo}» fuori dal menu e lo preme dopo un tasto destro vero`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(90_000);
    await app.evaluate(({ clipboard }) => clipboard.writeText('segreto-h-586'));
    if (modo === 'storia') {
      // Un Incolla vero, fatto prima su un'altra pagina: finisce nella cronologia.
      const altra = await testServer.openReady(openTab, '<!doctype html><title>Banca</title><input id="c">');
      await altra.locator('#c').click({ button: 'right' });
      await altra.locator('.sn-menu .sn-menu-paste-main').first().click();
      await expect(altra.locator('#c')).toHaveValue('segreto-h-586', { timeout: 5_000 });
      await app.evaluate(({ clipboard }) => clipboard.writeText('altro'));
    }
    const url = testServer.html(SPOSTA).replace('127.0.0.1', 'localhost');
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.evaluate((m) => { window.__modo = m; }, modo);
    await page.locator('#campo').click({ button: 'right' });
    await sleep(2500);
    const r = await page.evaluate(() => ({
      campo: document.getElementById('campo').value,
      pill: !!document.querySelector('.sn-dictate-pill'),
      storia: window.__storia || null,
      fatto: !!window.__fatto,
    }));
    console.log('H', modo, JSON.stringify(r));
  });
}

test('I: la cronologia di Incolla aperta passandoci sopra finisce nel documento del sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-banca-586'));
  const altra = await testServer.openReady(openTab, '<!doctype html><title>Banca</title><input id="c">');
  await altra.locator('#c').click({ button: 'right' });
  await altra.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect(altra.locator('#c')).toHaveValue('password-banca-586', { timeout: 5_000 });
  const url = testServer.html(`<!doctype html><title>Ostile</title><input id="campo" style="width:300px"><script>
    new MutationObserver(() => {
      const v = [...document.querySelectorAll('.sn-menu-history-item')].map((r) => r.dataset.snSearch + ' | ' + r.textContent);
      if (v.length) window.__letti = v;
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  </script>`).replace('127.0.0.1', 'localhost');
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-arrow')).toBeVisible();
  await page.locator('.sn-menu-paste-arrow').hover();
  await sleep(1000);
  console.log('I letti', JSON.stringify(await page.evaluate(() => window.__letti || null)));
});
