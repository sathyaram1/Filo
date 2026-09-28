// Permessi dei siti (#586): Incolla e Detta di Filo non passano dal permesso del sito, e il sito non sa premerli da
// solo; la strada vecchia per lo schermo (chromeMediaSource) non parte e non fa morire la scheda; l'Esc e la × chiudono
// la domanda, e tre chiusure di fila fanno smettere di chiedere. Senza la correzione il sito otteneva appunti e
// microfono senza domanda, e una riga di pagina uccideva la scheda.

import { test, expect } from './fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const riga = (shell) => shell.locator('#perm-bar .perm-row');

const PAGINA_CHE_PREME = `<!doctype html><html><head><title>Preme</title></head><body>
<input id="campo" style="width:300px">
<script>
  const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
  async function premiNelMenu(sel, testo) {
    const c = document.getElementById('campo');
    c.focus();
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 5, clientY: r.top + 5 }));
    for (let i = 0; i < 40; i++) {
      await attendi(50);
      const b = [...document.querySelectorAll(sel)].find((x) => !testo || x.textContent.includes(testo));
      if (b) { b.click(); return true; }
    }
    return false;
  }
  window.appunti = async () => {
    const menu = await premiNelMenu('.sn-menu .sn-menu-paste-main');
    await attendi(800);
    return { menu, campo: document.getElementById('campo').value };
  };
  window.detta = async () => {
    const menu = await premiNelMenu('.sn-menu .sn-menu-split-main', 'Detta');
    await attendi(800);
    return { menu, pill: !!document.querySelector('.sn-dictate-pill') };
  };
</script></body></html>`;

test('una pagina che finge un tasto destro non apre il menu di Filo, e non preme Incolla né Detta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('codice-segreto-586'));
  const page = await testServer.openReady(openTab, PAGINA_CHE_PREME);
  const a = await page.evaluate(() => window.appunti());
  expect(a.campo, 'gli appunti sono finiti nel campo del sito senza un gesto dell’utente').not.toBe('codice-segreto-586');
  expect(a.menu, 'un tasto destro finto ha aperto il menu di Filo').toBe(false);
  const d = await page.evaluate(() => window.detta());
  expect(d.pill, 'la dettatura è partita per un clic della pagina').toBe(false);
  // La pagina il bottone lo trova anche con un menu aperto da un tasto destro vero: il clic finto non conta.
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.evaluate(() => document.querySelector('.sn-menu .sn-menu-paste-main').click());
  await sleep(800);
  expect(await page.locator('#campo').inputValue()).not.toBe('codice-segreto-586');
});

const PAGINA_CHE_ASPETTA = `<!doctype html><html><head><title>Aspetta</title></head><body>
<textarea id="campo" style="width:300px"></textarea>
<script>
  // Il menu di Filo vive nel documento del sito: il suo clic passa anche dai gestori della pagina.
  window.__mic = null;
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('.sn-menu')) return;
    let n = 0;
    const prova = () => {
      if (window.__mic || n++ > 10) return;
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((s) => { window.__mic = s; }, () => setTimeout(prova, 150));
    };
    setTimeout(prova, 60);
  }, true);
</script></body></html>`;

test('Detta su un sito: il microfono lo apre Filo, il testo entra nel campo, e il sito non si prende l’ascolto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      models: { ...globalThis.SN_TEST_MODELS.models },
    });
    globalThis.__dettate = 0;
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => {
      globalThis.__dettate++;
      return { text: ` frase ${globalThis.__dettate} `, usage: { seconds: 1, costUsd: 0.00001 }, generationId: null };
    };
  });
  // Il microfono della cornice: un tono, che per il segmentatore è voce.
  await shell.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      window.__fintoMic = { gain };
      return dest.stream;
    };
  });
  const page = await testServer.openReady(openTab, PAGINA_CHE_ASPETTA);
  await page.locator('#campo').click();
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.locator('.sn-menu .sn-menu-split-main', { hasText: 'Detta' }).first().click();
  await expect(page.locator('.sn-dictate-pill')).toBeVisible({ timeout: 5_000 });
  await sleep(1800);
  await shell.evaluate(() => { window.__fintoMic.gain.gain.value = 0; });
  await expect.poll(() => page.locator('#campo').inputValue(), { timeout: 15_000 }).toMatch(/frase \d+ /);

  // Il sito aveva chiesto il microfono nello stesso istante: per lui c'è una domanda, non un flusso.
  expect(await page.evaluate(() => !!window.__mic), 'il sito si è preso il microfono durante la dettatura').toBe(false);
  await expect(riga(shell)).toContainText('vuole usare il microfono');
  await shell.locator('#perm-bar .perm-chiudi').click();

  await page.locator('.sn-dictate-pill').click();
  await expect(page.locator('.sn-dictate-pill')).toHaveCount(0, { timeout: 10_000 });
});

test('Incolla di Filo funziona anche con un’immagine assente e dopo un «Nega» agli appunti del sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<!doctype html><title>Nega</title><textarea id="campo"></textarea>'
    + '<script>window.leggi = () => navigator.clipboard.readText().then(() => "ok", (e) => "err:" + e.name);</script>');
  // Il sito chiede gli appunti per conto suo e l'utente dice di no.
  await page.locator('#campo').click();
  await page.evaluate(() => { window.__r = null; window.leggi().then((r) => { window.__r = r; }); });
  await expect(riga(shell)).toContainText('vuole leggere quello che hai copiato', { timeout: 10_000 });
  await shell.locator('#perm-bar .perm-no').click();
  await expect.poll(() => page.evaluate(() => window.__r)).toBe('err:NotAllowedError');
  // Incolla di Filo resta di Filo: il no del sito non lo spegne.
  await app.evaluate(({ clipboard }) => clipboard.writeText('mio testo'));
  await page.locator('#campo').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect(page.locator('#campo')).toHaveValue('mio testo', { timeout: 5_000 });
});

const VECCHIA = `<!doctype html><html><head><title>Vecchia</title></head><body>
<textarea id="campo"></textarea>
<script>
  const desktop = { mandatory: { chromeMediaSource: 'desktop' } };
  const esito = (p) => p.then((s) => 'ok:' + s.getTracks().map((t) => t.kind).join(','), (e) => 'err:' + e.name);
  window.prove = async () => ({
    schermoEAudio: await esito(navigator.mediaDevices.getUserMedia({ audio: desktop, video: desktop })),
    soloAudio: await esito(navigator.mediaDevices.getUserMedia({ audio: desktop, video: false })),
    schermoEMic: await esito(navigator.mediaDevices.getUserMedia({ audio: true, video: desktop })),
    comeOpzione: await esito(navigator.mediaDevices.getUserMedia({ video: { optional: [{ chromeMediaSource: 'screen' }] } })),
    riquadro: await (() => {
      const f = document.createElement('iframe');
      document.body.appendChild(f);
      return esito(f.contentWindow.navigator.mediaDevices.getUserMedia({ audio: desktop, video: false }));
    })(),
    vecchiaFirma: await new Promise((r) => navigator.webkitGetUserMedia({ video: desktop }, () => r('ok'), (e) => r('err:' + e.name))),
  });
</script></body></html>`;

test('la strada vecchia per lo schermo non parte, non chiede niente e non fa morire la scheda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, VECCHIA);
  let morta = false;
  page.on('crash', () => { morta = true; });
  await page.fill('#campo', 'testo che stavo scrivendo');
  const r = await page.evaluate(() => window.prove());
  expect(r).toEqual({
    schermoEAudio: 'err:NotAllowedError', soloAudio: 'err:NotAllowedError', schermoEMic: 'err:NotAllowedError',
    comeOpzione: 'err:NotAllowedError', riquadro: 'err:NotAllowedError', vecchiaFirma: 'err:NotAllowedError',
  });
  await sleep(500);
  expect(morta, 'la scheda è morta').toBe(false);
  await expect(riga(shell)).toHaveCount(0);
  expect(await page.locator('#campo').inputValue()).toBe('testo che stavo scrivendo');
});

const INSISTE = `<!doctype html><html><head><title>Insiste</title></head><body>
<script>
  window.insisti = () => setInterval(() => { navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {}); }, 100);
  window.unaVolta = () => navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'ok', (e) => 'err:' + e.name);
</script></body></html>`;

test('l’Esc chiude la domanda come la ×; tre chiusure di fila e Filo smette di chiedere, e la scheda lo dice', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, INSISTE);
  await page.evaluate(() => { window.__e = null; window.unaVolta().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(riga(shell)).toHaveCount(0, { timeout: 3_000 });
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('err:NotAllowedError');

  await page.evaluate(() => window.insisti());
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await shell.locator('#perm-bar .perm-chiudi').click();
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await shell.locator('#perm-bar .perm-chiudi').click();
  await sleep(1500);
  await expect(riga(shell), 'dopo tre chiusure la domanda è di nuovo lì').toHaveCount(0);
  await expect(shell.locator('.tab.active .perm-uso.bloccato')).toHaveAttribute('data-tip', /ho smesso di chiederti la fotocamera/);
});
