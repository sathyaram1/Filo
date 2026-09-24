// Verifica #663, giro 7 — stessa famiglia dei giri 3, 4, 5 e 6: la frase che
// spiega perché Filo non può rispondere arriva già scritta, ma la STRADA per
// togliere l'ostacolo la mette solo qualche superficie.
//
// Qui la porta più battuta di tutte: il menu del tasto destro su una parola
// selezionata, che in Filo è il gesto centrale. La spiegazione compare dentro
// il menu, nomina la pagina Crediti, e da lì non c'è niente da cliccare.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!doctype html><meta charset="utf-8"><title>Pagina</title>'
  + '<p id="p">Una frase con dentro la parola sonda.</p>';

async function configModelli(app, { chiave }) {
  await app.evaluate(async (_e, cfg) => {
    const C = globalThis.SN_CONST;
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    const models = {};
    for (const a of Object.values(C.ACTIONS)) models[a] = 'testo';
    D.get = () => ({
      ...orig(), provider: 'openrouter', models,
      modelRegistry: { testo: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' } },
      ...(cfg.chiave ? {} : { apiKeys: {} }),
    });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: cfg.chiave }, openWeightsOnly: false });
  }, { chiave });
}

// I crediti del giorno finiti: quello che capita a tutti, prima o poi.
async function creditiFiniti(app) {
  await app.evaluate(async () => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const boom = () => {
      const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}');
      e.status = 402; e.provider = 'openrouter';
      throw e;
    };
    globalThis.SN_PROVIDER_OPENROUTER = { ...P, streamComplete: boom, complete: boom };
  });
}

// Tasto destro sulla parola selezionata: il menu si apre con dentro la
// sezione della spiegazione.
async function menuSullaSelezione(page) {
  await page.evaluate(() => {
    const n = document.getElementById('p').firstChild;
    const r = document.createRange();
    r.setStart(n, 26); r.setEnd(n, 31);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  const box = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 15_000 });
}

test('senza chiave, la spiegazione nel menu del tasto destro dice cosa manca e porta dove si sistema', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, { chiave: '' });
  const page = await testServer.openReady(openTab, PAGINA);
  await menuSullaSelezione(page);

  const inline = page.locator('.sn-menu .sn-menu-inline').first();
  await expect(inline).toBeVisible({ timeout: 25_000 });
  await expect(inline).toContainText(/invito|crediti/i, { timeout: 25_000 });

  // La frase nomina la pagina Crediti e l'utente sta su un sito qualunque:
  // senza una strada cliccabile quell'indicazione è muta, come già accertato
  // per l'Aiuto e per il riquadro della spiegazione.
  const strada = page.locator('.sn-menu button, .sn-menu a').filter({ hasText: /crediti/i });
  await expect(strada.first()).toBeVisible({ timeout: 10_000 });
  try { await page.screenshot({ path: 'tests/.shots/663-giro7-menu-senza-chiave.png' }); } catch (_) {}
});

test('crediti finiti, la spiegazione nel menu del tasto destro porta dove si sistema', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, { chiave: 'k-test' });
  await creditiFiniti(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await menuSullaSelezione(page);

  const inline = page.locator('.sn-menu .sn-menu-inline').first();
  await expect(inline).toBeVisible({ timeout: 25_000 });
  await expect(inline).toContainText(/crediti/i, { timeout: 25_000 });
  await expect(inline).not.toContainText('402');

  const strada = page.locator('.sn-menu button, .sn-menu a').filter({ hasText: /crediti/i });
  await expect(strada.first()).toBeVisible({ timeout: 10_000 });
});
