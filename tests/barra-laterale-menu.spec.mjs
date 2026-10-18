// #871 — il tasto destro sulla barra laterale: le voci in fondo, l'ora, la striscia e la linguetta nella fila
// delle schede hanno le loro scelte; e un'azione della pagina portata nella barra ha il nome che ha sulla pagina.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, menuAperto, vociDelMenu, scegliNelMenu } from './helpers/barra.mjs';

const SITO = `<!doctype html><html lang="en"><body style="margin:0;padding:40px;font:16px sans-serif">
  <h1 id="t">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translator.</p>
</body></html>`;

const urlDelleSchede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.map((t) => t.url || '');
});
const opzioni = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return { ...w._filoTabs.barra.opzioni };
});

test('tasto destro su Cronologia, sull\'ora e su Impostazioni: le loro scelte, e fanno quello che dicono', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);

  await barra.locator('#fisse .ico[data-comando="history"]').click({ button: 'right' });
  let menu = await menuAperto(app);
  expect(menu, 'il menu della Cronologia non si è aperto').toBeTruthy();
  expect(await vociDelMenu(menu)).toEqual(['Apri la Cronologia', 'Cronologia AI']);
  await scegliNelMenu(menu, 'Cronologia AI');
  await expect.poll(() => urlDelleSchede(app)).toContain('filo://history/history.html');

  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#ora').click({ button: 'right' });
  menu = await menuAperto(app);
  expect(menu, 'il menu dell\'ora non si è aperto').toBeTruthy();
  const voci = await vociDelMenu(menu);
  const anno = String(new Date().getFullYear());
  expect(voci[0]).toContain(anno);
  expect(voci).toContain('Copia data e ora');
  await scegliNelMenu(menu, 'Copia data e ora');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain(anno);

  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#fisse .ico[data-comando="settings"]').click({ button: 'right' });
  menu = await menuAperto(app);
  expect(await vociDelMenu(menu)).toEqual(['Apri il menu Impostazioni', 'Preferenze', 'Regola la barra laterale…']);
  await scegliNelMenu(menu, 'Regola la barra laterale…');
  await expect.poll(async () => (await urlDelleSchede(app)).some((u) => u.startsWith('filo://preferences/preferences.html'))).toBe(true);
});

test('tasto destro sulla striscia e sulla linguetta: nascondere la striscia e spegnere l\'apertura dal bordo', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);

  await barra.locator('#striscia').click({ button: 'right', position: { x: 1, y: 200 } });
  let menu = await menuAperto(app);
  expect(menu, 'il menu della striscia non si è aperto').toBeTruthy();
  expect(await vociDelMenu(menu)).toEqual(['Apri la barra laterale', 'Nascondi la striscia sul bordo', 'Non aprirla spingendo sul bordo', 'Regola la barra laterale…']);
  await scegliNelMenu(menu, 'Nascondi la striscia sul bordo');
  await expect.poll(async () => (await opzioni(app)).striscia).toBe(false);
  await expect(barra.locator('html.senza-striscia')).toHaveCount(1);
  await expect.poll(() => barra.evaluate(() => getComputedStyle(document.getElementById('striscia'), '::before').opacity)).toBe('0');
  // Resta salvata: la pagina Preferenze la legge uguale.
  expect((await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).barraLaterale)).striscia).toBe(false);

  await shell.locator('#barra-maniglia').click({ button: 'right' });
  menu = await menuAperto(app);
  expect(menu, 'il menu della linguetta non si è aperto').toBeTruthy();
  expect(await vociDelMenu(menu)).toContain('Mostra la striscia sul bordo');
  await scegliNelMenu(menu, 'Non aprirla spingendo sul bordo');
  await expect.poll(async () => (await opzioni(app)).spinta).toBe(false);

  // Spenta, la spinta sul bordo non apre più; il clic sulla striscia sì.
  await barra.mouse.move(1, 300);
  await barra.waitForTimeout(700);
  expect((await statoBarra(app)).aperta).toBe(false);
  await barra.mouse.click(1, 300);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
});

// Finta traduzione nel main (come tests/translate-page.spec.mjs): "IT " davanti a ogni blocco.
async function traduzioneFinta(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((x) => `IT ${x}`).join('\n@@@SN_SEP@@@\n');
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

test('«Traduci» nella barra: a pagina tradotta si chiama «Mostra originale», come nel menu, e riporta l\'originale', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await traduzioneFinta(app);
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'translate', target: 'bar' }, {}));
  expect(r.ok).toBe(true);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const icona = barra.locator('#nav .ico[data-id="translate"]');
  await expect(icona).toHaveAttribute('aria-label', 'Traduci');
  await icona.click();
  await expect(p.locator('#p1')).toContainText('IT ', { timeout: 10_000 });

  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(icona).toHaveAttribute('aria-label', 'Mostra originale', { timeout: 5000 });
  await expect(icona).toHaveAttribute('data-icona', 'showOriginal');
  await icona.click();
  await expect(p.locator('#p1')).not.toContainText('IT ', { timeout: 10_000 });

  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(icona).toHaveAttribute('aria-label', 'Traduci', { timeout: 5000 });
});

test('tasto destro su Indietro e Avanti: le pagine della scheda dalla più vicina, e la scelta ci porta', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>Pagina Alfa</title><body><h1>A</h1></body>');
  const b = testServer.html('<!doctype html><title>Pagina Beta</title><body><h1>B</h1></body>');
  const c = testServer.html('<!doctype html><title>Pagina Gamma</title><body><h1>C</h1></body>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  for (const u of [b, c]) {
    await page.evaluate((x) => { location.href = x; }, u);
    await page.waitForURL(u);
  }
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);

  await barra.locator('#nav .ico[data-id="back"]').click({ button: 'right' });
  let menu = await menuAperto(app);
  expect(menu, 'il menu di Indietro non si è aperto').toBeTruthy();
  expect(await vociDelMenu(menu)).toEqual(['Pagina Beta', 'Pagina Alfa', 'Rimetti nel menu del tasto destro']);
  await scegliNelMenu(menu, 'Pagina Alfa');
  await page.waitForURL(a);

  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="forward"]').click({ button: 'right' });
  menu = await menuAperto(app);
  expect(await vociDelMenu(menu)).toEqual(['Pagina Beta', 'Pagina Gamma', 'Rimetti nel menu del tasto destro']);
  await scegliNelMenu(menu, 'Pagina Gamma');
  await page.waitForURL(c);
});

test('tasto destro su Indietro con una cronologia lunga: le prime quindici, e quante altre ce ne sono', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  for (let i = 1; i <= 17; i++) await page.evaluate((n) => { location.hash = `#p${n}`; }, i);
  await expect.poll(() => page.evaluate(() => history.length)).toBeGreaterThanOrEqual(18);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="back"]').click({ button: 'right' });
  const menu = await menuAperto(app);
  expect(menu, 'il menu di Indietro non si è aperto').toBeTruthy();
  const voci = await vociDelMenu(menu);
  expect(voci.filter((v) => v.includes('#p') || v.includes('/')).length).toBeGreaterThanOrEqual(15);
  expect(voci).toContain('…e altre 2 pagine più indietro');
});
