// Verifica #1589 giro 24, esplorazione dopo il riallineamento: pavimento delle immagini al livello di serie, correttore
// su una pagina di sanità col codice del correttore arrivato da main.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SANITA = 'sanita-di-prova.test';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function modelliFinti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      globalThis.__mandato.push(JSON.stringify(messages));
      return { text: 'Descrizione finta.', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
}
const immaginiMandate = (app) => app.evaluate(() => globalThis.__mandato.filter((m) => m.includes('image_url')).length);
async function apriSu(openTab, testServer, host, corpo) {
  const url = testServer.html(corpo).replace('127.0.0.1', host);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  return page;
}
async function tastoDestroSullaFoto(page) {
  const b = await page.locator('#foto').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const sezione = menuDi(page).locator('.sn-menu-inline[data-subject="image"]');
  await expect(sezione).toBeVisible({ timeout: 10_000 });
  return sezione;
}

test.use({ hostInPiu: [SANITA, 'sito-pubblico.test', 'accesso-pubblico.test'] });

test('al livello di serie, da una pagina con un campo password il tasto destro su un\'immagine non parte da solo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelliFinti(app);
  const libera = await apriSu(openTab, testServer, 'sito-pubblico.test', `<!doctype html><title>Ricetta</title>
    <body style="padding:40px"><img id="foto" src="${PNG}" style="width:160px;height:120px;display:block"></body>`);
  await tastoDestroSullaFoto(libera);
  await expect.poll(() => immaginiMandate(app), { timeout: 10_000 }).toBe(1);
  await libera.keyboard.press('Escape');
  await app.evaluate(() => globalThis.SN_AI_CACHE.clear());

  const accesso = await apriSu(openTab, testServer, 'accesso-pubblico.test', `<!doctype html><title>Accedi</title>
    <body style="padding:40px"><img id="foto" src="${PNG}" style="width:160px;height:120px;display:block">
    <label>Password <input id="pw" type="password"></label></body>`);
  await pausa(800);
  const sezione = await tastoDestroSullaFoto(accesso);
  await pausa(1500);
  expect(await immaginiMandate(app), 'da una pagina col campo password l\'immagine non parte da sola').toBe(1);
  await expect(sezione.locator('.sn-menu-inline-chiedi-tasto')).toHaveText('Descrivi');
});

test('su una pagina di sanità col livello di serie il correttore aspetta «Controlla», e «Controlla» parte', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelliFinti(app);
  await app.evaluate(({}, SANITA) => {
    const P = globalThis.SN_PAGINE_DELICATE.PREDEFINITI;
    if (!P.sanita.includes(SANITA)) P.sanita.push(SANITA);
  }, SANITA);
  const scrivi = await apriSu(openTab, testServer, SANITA, `<!doctype html><title>Messaggio al medico</title>
    <body style="padding:30px"><textarea id="t" style="width:400px;height:120px"></textarea></body>`);
  await scrivi.locator('#t').click();
  await scrivi.keyboard.type('Gentile dottore, le analisi del sangue sono arivate ieri. ', { delay: 20 });
  await pausa(2500);
  const delCampo = () => app.evaluate(() => globalThis.__mandato.filter((m) => m.includes('analisi del sangue')).length);
  expect(await delCampo(), 'sulla sanità il correttore non manda niente da solo').toBe(0);
  await scrivi.locator('#t').click({ button: 'right' });
  const controlla = menuDi(scrivi).voce('Controlla');
  await expect(controlla).toBeVisible({ timeout: 10_000 });
  await controlla.click();
  await expect.poll(delCampo, { timeout: 10_000 }).toBeGreaterThan(0);
  const mandati = await app.evaluate(() => globalThis.__mandato.filter((m) => m.includes('analisi del sangue')));
  expect(mandati.join(' '), 'chiesto, il controllo parte senza il titolo della pagina').not.toContain('Messaggio al medico');
});
