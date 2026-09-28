// Verifica #586 giro 12: esplorazione, seconda parte.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><html><head><title>Chiama</title></head><body>
<textarea id="campo"></textarea>
<script>
  window.mic = () => navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { window.__s = s; return 'ok'; }, (e) => 'err:' + e.name);
  window.cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { window.__c = s; return 'ok'; }, (e) => 'err:' + e.name);
  window.vivo = () => (window.__s ? window.__s.getAudioTracks().map((t) => t.readyState).join(',') : 'nessuna');
  window.soloAudioSchermo = () => navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: false })
    .then((s) => 'ok:' + s.getTracks().length, (e) => 'err:' + e.name);
  window.schermoEMic = () => navigator.mediaDevices.getUserMedia({ audio: true, video: { mandatory: { chromeMediaSource: 'desktop' } } })
    .then((s) => 'ok:' + s.getTracks().map((t) => t.kind + ':' + t.label).join('|'), (e) => 'err:' + e.name);
  window.camInRiquadro = () => {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    return f.contentWindow.navigator.mediaDevices.getUserMedia({ video: true }).then((s) => 'ok:' + s.getTracks().length, (e) => 'err:' + e.name);
  };
</script></body></html>`;

async function consenti(shell) {
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  const si = shell.locator('#perm-bar .perm-si');
  await expect(si).toBeEnabled();
  await si.click();
}

test('esplora: microfono aperto, segni sulla scheda e revoca da Sicurezza', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const schedaPrima = await shell.evaluate(() => document.querySelector('.tab.active')?.outerHTML.length);
  await page.evaluate(() => { window.__e = null; window.mic().then((r) => { window.__e = r; }); });
  await consenti(shell);
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('ok');
  await sleep(500);
  const scheda = await shell.evaluate(() => {
    const t = document.querySelector('.tab.active');
    return { len: t?.outerHTML.length, testo: t?.innerText, tip: [...(t?.querySelectorAll('[data-tip]') || [])].map((x) => x.dataset.tip) };
  });
  console.log('SCHEDA prima', schedaPrima, 'dopo', JSON.stringify(scheda));
  console.log('CORNICE', JSON.stringify((await shell.evaluate(() => document.body.innerText)).slice(0, 400)));

  const sec = await openTab('filo://security/security.html');
  const rigaMic = sec.locator('.sn-perm-riga[data-tipo="microfono"]');
  await expect(rigaMic).toBeVisible({ timeout: 10_000 });
  await rigaMic.locator('.sn-perm-togli').click();
  await expect(rigaMic).toHaveCount(0, { timeout: 5_000 });
  await sleep(1500);
  const avvisi = await shell.evaluate(() => document.body.innerText);
  console.log('DOPO REVOCA da Sicurezza: traccia', await page.evaluate(() => window.vivo()),
    'avviso in cornice', /acces|ricaric/i.test(avvisi), 'avviso in pagina', /acces|ricaric/i.test(await sec.evaluate(() => document.body.innerText)));
});

test('esplora: le Impostazioni aperte in incognito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { window.__e = null; window.mic().then((r) => { window.__e = r; }); });
  await consenti(shell);
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('ok');

  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(() => { inc = app.windows().find((w) => w.url().includes('incognito=1')); return !!inc; }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  await inc.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  let sec = null;
  await expect.poll(() => {
    sec = app.windows().filter((w) => w.url().startsWith('filo://security/')).pop();
    return !!sec;
  }).toBe(true);
  await sec.waitForLoadState('domcontentloaded');
  await sleep(1500);
  const quale = await app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .filter((x) => x.getURL().startsWith('filo://security/')).map((x) => x.session === require('electron').session.defaultSession));
  console.log('SICUREZZA DA INCOGNITO: sessione predefinita?', JSON.stringify(quale),
    'elenco:', JSON.stringify(await sec.evaluate(() => document.getElementById('perm-list')?.innerText)));
});

test('esplora: la scheda muore?', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  for (const fn of ['soloAudioSchermo', 'schermoEMic']) {
    const page = await testServer.openReady(openTab, PAGINA);
    const url = page.url();
    await page.fill('#campo', 'testo che stavo scrivendo');
    await page.evaluate((f) => { window.__e = null; window[f]().then((r) => { window.__e = r; }); }, fn);
    await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
    const domanda = await riga(shell).innerText();
    await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
    await shell.locator('#perm-bar .perm-si').click();
    await sleep(2500);
    const stato = await app.evaluate(({ webContents }, u) => {
      const wc = webContents.getAllWebContents().find((x) => x.getURL() === u);
      return wc ? { crashed: wc.isCrashed(), url: wc.getURL() } : { sparita: true };
    }, url);
    let esito = null; let campo = null;
    try { esito = await page.evaluate(() => window.__e); campo = await page.evaluate(() => document.getElementById('campo').value); } catch (e) { esito = 'EVAL:' + e.message.slice(0, 80); }
    console.log('CRASH', fn, JSON.stringify(domanda), JSON.stringify(stato), esito, campo);
  }
});

test('esplora: riquadro senza indirizzo dopo un sì alla pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { window.__e = null; window.cam().then((r) => { window.__e = r; }); });
  await consenti(shell);
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('ok');
  const r = await page.evaluate(() => Promise.race([window.camInRiquadro(), new Promise((res) => setTimeout(() => res('appeso'), 4000))]));
  console.log('RIQUADRO', r, 'righe', await riga(shell).count());
});

test('esplora: domanda di una scheda in secondo piano', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const a = await testServer.openReady(openTab, PAGINA);
  const b = await testServer.openReady(openTab, PAGINA.replace('Chiama', 'Altra'));
  await a.evaluate(() => { window.__e = null; window.cam().then((r) => { window.__e = r; }); });
  await sleep(1000);
  console.log('SECONDO PIANO righe', await riga(shell).count(), 'icona', await shell.locator('.tab .tab-perm, .tab [class*=perm]').count());
  await b.evaluate(() => { window.__e = null; window.mic().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  console.log('B', await riga(shell).innerText());
});
