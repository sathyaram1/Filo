// Verifica #586 giro 13, rilievo 1: il permesso che Filo si dà per Incolla e Detta lo usa anche il sito.
// Successo: il sito non ottiene gli appunti né il microfono senza una domanda a cui l'utente abbia detto sì.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA_CHE_PREME = `<!doctype html><html><head><title>Preme</title></head><body>
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
  window.appunti = async () => {
    await premiNelMenu('.sn-menu .sn-menu-paste-main');
    let mio = null;
    const fine = Date.now() + 2500;
    while (Date.now() < fine && mio == null) {
      navigator.clipboard.readText().then((t) => { if (mio == null) mio = t; }, () => {});
      await attendi(15);
    }
    await attendi(500);
    return { campo: document.getElementById('campo').value, mio };
  };
  window.microfono = async () => {
    await premiNelMenu('.sn-menu .sn-menu-split-main', 'Detta');
    let preso = null;
    const fine = Date.now() + 2500;
    while (Date.now() < fine && !preso) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { if (!preso) { preso = s; window.__tieni = s; } }, () => {});
      await attendi(15);
    }
    await attendi(300);
    return preso ? preso.getAudioTracks().map((t) => t.readyState).join(',') : null;
  };
</script></body></html>`;

test('una pagina che preme da sola Incolla nel menu di Filo non si prende gli appunti', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('codice-segreto-586'));
  const page = await testServer.openReady(openTab, PAGINA_CHE_PREME);
  const r = await page.evaluate(() => window.appunti());
  expect(r.mio, 'il sito legge gli appunti da sé').not.toBe('codice-segreto-586');
  expect(r.campo, 'gli appunti finiscono nel campo del sito senza gesto dell’utente').not.toBe('codice-segreto-586');
});

test('una pagina che preme da sola Detta nel menu di Filo non si prende il microfono', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA_CHE_PREME);
  const r = await page.evaluate(() => window.microfono());
  expect(r, 'il sito ha un microfono suo, acceso, senza domanda').toBeNull();
  expect(await app.evaluate(() => globalThis.__filoPermessi.elenco(null))).toEqual([]);
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

test('chi usa Detta su un sito non gli regala un microfono che resta acceso', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA_CHE_ASPETTA);
  await page.locator('#campo').click();
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.locator('.sn-menu .sn-menu-split-main', { hasText: 'Detta' }).first().click();
  await sleep(2500);
  const r = await page.evaluate(() => (window.__mic ? window.__mic.getAudioTracks().map((t) => t.readyState).join(',') : null));
  expect(r, 'il sito si è preso il microfono durante la dettatura').toBeNull();
});
