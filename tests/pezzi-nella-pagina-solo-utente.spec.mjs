// #592.16 — I pezzi di Filo che stanno nel documento di un sito vanno avanti solo per un tasto o un clic dell'utente:
// la conferma di «Salva per dopo», il riquadro da scegliere per catturare o trascrivere, il QR, il rimedio dell'Aiuto.
// Regola: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md.

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo, nelloStrato, paginaDelloStrato } from './helpers/riquadri.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Pagina ostile</title></head>
<body style="margin:0;height:100vh;font:16px sans-serif"><p id="t" style="margin:120px 40px;font-size:28px">Un testo da trascrivere</p></body></html>`;

// Il codice della pagina preme un nostro pezzo come può: clic, tasti, e per il riquadro da scegliere un trascinamento.
const premeDaSola = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  el.focus();
  el.click();
  for (const key of ['Enter', ' ']) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return true;
}, sel);

const listaAperta = (app) => app.windows().some((w) => { try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; } });

test('la conferma di «Salva per dopo»: premuta dal codice della pagina non apre la lista, dall\'utente sì', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await premiNellaBarra(app, 'saveForLater');
  const pill = page.locator('.sn-save-confirm');
  await expect(pill).toBeVisible({ timeout: 5000 });
  // Col puntatore sopra la conferma aspetta: la scheda non si chiude mentre la pagina prova.
  await pill.hover();
  expect(await premeDaSola(page, '.sn-save-confirm')).toBe(true);
  await page.waitForTimeout(800);
  expect(listaAperta(app), 'la pagina non apre la lista per l\'utente').toBe(false);
  await expect(pill).toBeVisible();
  await pill.click();
  await expect.poll(() => listaAperta(app), { timeout: 8000 }).toBe(true);
});

test('trascrivi una parte della pagina: il riquadro lo sceglie il mouse dell\'utente, non il codice della pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await nelMondoDiFilo(app, page, () => {
    window.__trascrizioni = 0;
    const M = globalThis.SN_MSG.MSG;
    const A = globalThis.SN_CONST.ACTIONS;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === M.AI_REQUEST && m.action === A.TRANSCRIBE_IMAGE) { window.__trascrizioni++; return Promise.resolve({ ok: true, text: 'Un testo da trascrivere' }); }
      return orig(m, ...r);
    };
    return true;
  });
  const trascrizioni = () => nelMondoDiFilo(app, page, () => window.__trascrizioni);
  await premiNellaBarra(app, 'transcribe');
  const overlay = page.locator('.sn-region-overlay');
  await expect(overlay).toBeVisible({ timeout: 10_000 });

  await page.evaluate(() => {
    const o = document.querySelector('.sn-region-overlay');
    const m = (type, x, y) => o.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
    m('mousedown', 30, 100);
    m('mousemove', 300, 140);
    m('mousemove', 500, 180);
    m('mouseup', 500, 180);
  });
  await page.waitForTimeout(800);
  await expect(overlay, 'la scelta resta all\'utente').toBeVisible();
  expect(await trascrizioni()).toBe(0);

  await page.mouse.move(30, 100);
  await page.mouse.down();
  await page.mouse.move(300, 140, { steps: 5 });
  await page.mouse.move(500, 180, { steps: 5 });
  await page.mouse.up();
  await expect(overlay).toHaveCount(0);
  await expect.poll(trascrizioni, { timeout: 10_000 }).toBe(1);
});

test('QR della pagina: «Scarica» e «Copia link» premuti dal codice della pagina non fanno niente, dall\'utente sì', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const appunti = () => app.evaluate(({ clipboard }) => clipboard.readText());
  await app.evaluate(({ clipboard }) => clipboard.writeText('appunti dell\'utente'));
  await premiNellaBarra(app, 'qrCode');
  const overlay = page.locator('.sn-qr-overlay');
  await expect(overlay).toBeVisible({ timeout: 8000 });

  const scaricati = [];
  page.on('download', (d) => scaricati.push(d.suggestedFilename()));
  await page.evaluate(() => { for (const b of document.querySelectorAll('.sn-qr-overlay button')) b.click(); });
  await page.waitForTimeout(800);
  expect(await appunti(), 'gli appunti restano quelli dell\'utente').toBe('appunti dell\'utente');
  expect(scaricati).toEqual([]);
  await expect(overlay).toBeVisible();

  await overlay.locator('button').nth(1).click();
  await expect.poll(appunti).toBe(page.url());
});

// Su un sito l'Aiuto sta nello strato sopra la scheda (#1509.3): il codice della pagina non trova nemmeno il rimedio.
test('il rimedio sotto un errore dell\'Aiuto: premuto dal codice della pagina non apre niente, dall\'utente sì', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await nelMondoDiFilo(app, page, () => { globalThis.SN_SIDEBAR.open(); return true; });
  const strato = await paginaDelloStrato(app, page);
  await strato.waitForSelector('.sn-sidebar-input textarea');
  await nelloStrato(app, page, () => {
    window.__aperte = [];
    const M = globalThis.SN_MSG.MSG;
    const A = globalThis.SN_CONST.ACTIONS;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === M.AI_REQUEST && m.action === A.HELP) return Promise.resolve({ ok: false, error: 'Serve una chiave', code: 'NO_API_KEY' });
      if (m && m.type === M.OPEN_URL) { window.__aperte.push(m.url); return Promise.resolve({ ok: true }); }
      return orig(m, ...r);
    };
    return true;
  });
  const aperte = () => nelloStrato(app, page, () => window.__aperte.slice());
  await strato.click('.sn-sidebar-input textarea');
  await strato.keyboard.type('aiutami');
  await strato.keyboard.press('Enter');
  const rimedio = strato.locator('.sn-sidebar-choice', { hasText: 'Apri Crediti' });
  await expect(rimedio).toBeVisible({ timeout: 10_000 });

  expect(await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sn-sidebar-choice')];
    b.forEach((x) => x.click());
    return b.length;
  })).toBe(0);
  await page.waitForTimeout(800);
  expect(await aperte()).toEqual([]);

  await rimedio.click();
  await expect.poll(aperte).toEqual(['filo://credits/credits.html']);
});
