// #1434.2 — la fila del tasto destro nei campi dove si scrive e con le icone della finestra: Taglia fa quello che fa il
// Taglia del sistema (Ctrl+Z lo annulla, anche in una casella per l'email o per un numero, e in una password non c'è),
// una casella senza formattazione ha taglia, copia e incolla, le icone della finestra sono spente come nella barra, e
// col menu nello strato un'icona va dalla fila alla barra e torna.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const iconeDellaFila = (menu) => menu.locator('.sn-menu-row .sn-menu-row-btn[data-sn-icon-id]')
  .evaluateAll((els) => els.map((e) => e.dataset.snIconId));
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const salvata = (app) => app.evaluate(async () => globalThis.SN_LAYOUT_ICONE.leggi());
const esegui = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);

async function fermo(loc) {
  let prima = null;
  for (let i = 0; i < 40; i++) {
    const ora = await loc.boundingBox();
    if (ora && prima && ['x', 'y', 'width', 'height'].every((k) => Math.abs(ora[k] - prima[k]) < 0.5)) return ora;
    prima = ora;
    await pausa(120);
  }
  return prima;
}

const CAMPO = 'display:block;width:300px;margin-top:16px;font:16px sans-serif';
const CAMPI = `<!doctype html><html><head><title>Campi</title></head><body style="margin:0;padding:40px">
  <input id="testo" type="text" value="una parola qui" style="${CAMPO}">
  <input id="mail" type="email" value="mario@posta.it" style="${CAMPO}">
  <input id="numero" type="number" value="12345" style="${CAMPO}">
  <input id="segreta" type="password" value="segreta123" style="${CAMPO}">
  <input id="cerca" type="search" value="cosa cerco" style="${CAMPO}">
  <textarea id="area" style="${CAMPO};height:50px">un'area di testo</textarea>
  <div id="piano" contenteditable="plaintext-only" style="${CAMPO};border:1px solid #888">solo testo qui</div>
  <div id="ricco" contenteditable="true" style="${CAMPO};border:1px solid #888">testo ricco qui</div>
  </body></html>`;

// Tutto il campo selezionato, e il tasto destro sopra la selezione.
async function destroSulCampo(page, sel) {
  await page.locator(sel).focus();
  await page.keyboard.press('Control+a');
  await page.locator(sel).click({ button: 'right', position: { x: 12, y: 8 } });
}

test('Taglia nella fila toglie la parola come il sistema: Ctrl+Z la rimette, e vale anche in una casella per l\'email o per un numero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CAMPI);
  const menu = menuDi(page);
  const fila = menu.locator('.sn-menu-row');

  // Una parola sola, all'inizio della casella: il tasto destro le sta sopra.
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await page.locator('#testo').focus();
  await page.evaluate(() => document.getElementById('testo').setSelectionRange(0, 3));
  await page.locator('#testo').click({ button: 'right', position: { x: 8, y: 8 } });
  await expect(fila).toBeVisible();
  expect(await iconeDellaFila(menu)).toEqual(['campo:cut', 'campo:copy', 'campo:paste']);
  await fila.locator('[data-sn-icon-id="campo:cut"]').click();
  await expect.poll(() => appunti(app)).toBe('una');
  await expect.poll(() => page.locator('#testo').inputValue()).toBe(' parola qui');
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.locator('#testo').inputValue()).toBe('una parola qui');

  // Email dalla fila, numero dalla voce Taglia sotto la fila: la stessa azione.
  await destroSulCampo(page, '#mail');
  await expect(fila).toBeVisible();
  await fila.locator('[data-sn-icon-id="campo:cut"]').click();
  await expect.poll(() => appunti(app)).toBe('mario@posta.it');
  await expect.poll(() => page.locator('#mail').inputValue()).toBe('');
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.locator('#mail').inputValue()).toBe('mario@posta.it');

  await destroSulCampo(page, '#numero');
  await expect(menu.voce('Taglia')).toBeVisible();
  await menu.voce('Taglia').click();
  await expect.poll(() => appunti(app)).toBe('12345');
  await expect.poll(() => page.locator('#numero').inputValue()).toBe('');
});

test('in un campo password la fila e le voci non offrono Taglia e Copia, come il menu del sistema; Incolla resta', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CAMPI);
  const menu = menuDi(page);
  await app.evaluate(({ clipboard }) => clipboard.writeText('dagli appunti'));
  await destroSulCampo(page, '#segreta');
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  expect(await iconeDellaFila(menu)).toEqual(['campo:paste']);
  await expect(menu.locator('.sn-menu-paste-main', { hasText: 'Incolla' })).toBeVisible();
  await expect(menu.voce('Taglia')).toHaveCount(0);
  await expect(menu.voce('Copia')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await page.locator('#segreta').inputValue()).toBe('segreta123');
  expect(await appunti(app)).toBe('dagli appunti');
});

test('in una casella senza formattazione la fila dà Taglia, Copia e Incolla, con Cerca nel «+»; in un campo ricco la formattazione', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CAMPI);
  const menu = menuDi(page);
  const fila = menu.locator('.sn-menu-row');
  for (const sel of ['#cerca', '#area', '#piano']) {
    await destroSulCampo(page, sel);
    await expect(fila).toBeVisible();
    expect(await iconeDellaFila(menu), sel).toEqual(['campo:cut', 'campo:copy', 'campo:paste']);
    await fila.locator('.sn-menu-row-overflow').click();
    await expect(menu.locator('.sn-menu-icon-grid [data-sn-icon-id="campo:search"]'), sel).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(menu.pannelli).toHaveCount(0);
  }
  // Copia dalla fila dell'area di testo: negli appunti, e il testo resta.
  await destroSulCampo(page, '#area');
  await fila.locator('[data-sn-icon-id="campo:copy"]').click();
  await expect.poll(() => appunti(app)).toBe('un\'area di testo');
  expect(await page.locator('#area').inputValue()).toBe('un\'area di testo');

  await destroSulCampo(page, '#ricco');
  await expect(fila).toBeVisible();
  expect((await iconeDellaFila(menu)).slice(0, 2)).toEqual(['scrivibile:bold', 'scrivibile:italic']);
});

test('su un filmato o un audio icona e voce si chiamano allo stesso modo, e fanno la stessa cosa', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px">
    <audio id="aud" controls></audio></body></html>`);
  const menu = menuDi(page);
  await page.locator('#aud').click({ button: 'right' });
  const salva = menu.locator('.sn-menu-row [data-sn-icon-id="media:save"]');
  await expect(salva).toHaveAttribute('aria-label', 'Salva audio come…');
  await expect(menu.voce('Salva audio come…')).toBeVisible();
  // Ripeti dalla voce; riaperto, voce e icona del «+» dicono di toglierlo, e l'icona lo toglie.
  await menu.voce('Ripeti in continuo').click();
  await expect.poll(() => page.evaluate(() => document.getElementById('aud').loop)).toBe(true);
  await page.locator('#aud').click({ button: 'right' });
  await expect(menu.voce('Non ripetere')).toBeVisible();
  await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
  const ripeti = menu.locator('.sn-menu-icon-grid [data-sn-icon-id="media:loop"]');
  await expect(ripeti).toHaveAttribute('aria-label', 'Non ripetere');
  await ripeti.click();
  await expect.poll(() => page.evaluate(() => document.getElementById('aud').loop)).toBe(false);
});

test('un\'icona della finestra nella fila è spenta come nella barra, premuta fa la sua azione, e «Feedback» resta dell\'owner', async ({ app, openTab, testServer }) => {
  expect((await esegui(app, { type: 'SPOSTA_ICONA', icona: 'back', dove: 'fila', contesto: 'pagina' })).executed).toBe(true);
  expect((await esegui(app, { type: 'SPOSTA_ICONA', icona: 'feedbackApp', dove: 'fila', contesto: 'pagina' })).executed).toBe(true);
  const seconda = testServer.html('<!doctype html><html><head><title>Seconda</title></head><body style="height:900px"><div id="vuoto" style="height:400px"></div></body></html>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Prima</title></head>
    <body style="margin:0;padding:40px;height:900px"><a id="vai" href="${seconda}">avanti</a><div id="vuoto" style="height:400px"></div></body></html>`);
  const prima = page.url();
  const menu = menuDi(page);
  const indietro = menu.locator('.sn-menu-row [data-sn-icon-id="back"]');

  // Scheda appena aperta: non c'è dove tornare.
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(indietro).toBeVisible();
  await expect(indietro).toHaveAttribute('data-sn-disabled', '1');
  await expect(menu.locator('.sn-menu-row [data-sn-icon-id="feedbackApp"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.locator('#vai').click();
  await page.waitForURL(seconda);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(indietro).toBeVisible();
  await expect(indietro).not.toHaveAttribute('data-sn-disabled', '1');
  await indietro.click();
  await expect.poll(() => page.url()).toBe(prima);
});

test.describe('col menu nello strato sopra la scheda', () => {
  test.use({ stratoDelMenu: true });

  test('un\'icona va dalla fila alla barra e dalla barra alla fila', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    expect((await esegui(app, { type: 'SPOSTA_ICONA', icona: 'saveForLater', dove: 'fila', contesto: 'pagina' })).executed).toBe(true);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Strato</title></head>
      <body style="margin:0;padding:40px;height:1200px"><div id="vuoto" style="height:400px"></div></body></html>`);
    const barra = await barraPage(app);
    const menu = menuDi(page);
    await page.locator('#vuoto').click({ button: 'right' });
    await expect(menu.locator('.sn-menu-row [data-sn-icon-id="saveForLater"]')).toBeVisible();
    expect(menu.superficie.url()).toMatch(/^filo:\/\/menu\//);

    // Dalla fila alla barra: il trascinamento la apre, e la barra la prende davanti a Home.
    const m = menu.superficie;
    const icona = await fermo(menu.locator('.sn-menu-row [data-sn-icon-id="saveForLater"]'));
    await m.mouse.move(icona.x + icona.width / 2, icona.y + icona.height / 2);
    await m.mouse.down();
    await m.mouse.move(icona.x + 12, icona.y + 12, { steps: 3 });
    await m.mouse.move(20, icona.y + 12, { steps: 8 });
    await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
    await pannelloFermo(barra);
    const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
    await m.mouse.move(30, home.y + 4, { steps: 6 });
    await expect(barra.locator('#nav')).toHaveClass(/mira/);
    await m.mouse.up();
    await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 6)).toEqual(['help', 'back', 'forward', 'reload', 'saveForLater', 'home']);
    await expect.poll(async () => (await salvata(app))['fila:pagina']).toEqual([]);
    await comandaBarra(app, 'chiudi');

    // Dalla barra alla fila: la fila vuota della pagina si apre per accoglierla.
    await page.keyboard.press('Escape');
    await page.locator('#vuoto').click({ button: 'right' });
    await expect(menu.principale).toBeVisible();
    await expect(menu.locator('.sn-menu-row')).toBeHidden();
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    const src = await barra.locator('#nav .ico[data-id="saveForLater"]').boundingBox();
    const box = await fermo(menu.principale);
    const s = await statoBarra(app);
    const alto = s.bounds.y - s.alto;
    await barra.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await barra.mouse.down();
    await barra.mouse.move(src.x + 30, src.y + 10, { steps: 3 });
    await barra.mouse.move(box.x + 40, box.y + 12 - alto, { steps: 10 });
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    const fila = await fermo(menu.locator('.sn-menu-row'));
    await barra.mouse.move(fila.x + 20, fila.y + fila.height / 2 - alto, { steps: 4 });
    await barra.mouse.up();
    await expect.poll(async () => (await salvata(app))['fila:pagina']).toEqual(['saveForLater']);
    await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('saveForLater');
  });
});
