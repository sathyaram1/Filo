// #1434.3 — «taglia» chiesto a Filo dall'Aiuto della pagina taglia quello che è selezionato adesso, non il campo
// dell'ultimo tasto destro, e da nessuna strada taglia una password. Senza il fix il testo usciva dal campo di prima.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { paginaDellAiuto, statoDi, scrivi, clicca } from './helpers/riquadri.mjs';

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

// Su http una password fa comparire l'avviso del sito sospetto, che rende la scheda inerte finché non si sceglie
// «Continua»: è quello che farebbe l'utente prima di scrivere.
async function apriCampi(app, openTab, testServer) {
  const page = await testServer.openReady(openTab, CAMPI);
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  await expect.poll(coperta, { timeout: 10_000 }).toBe(true);
  await (await vistaAvviso(app)).getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
  return page;
}

const CAMPO = 'display:block;width:300px;margin-top:16px;font:16px sans-serif';
const CAMPI = `<!doctype html><html><head><title>Campi</title></head><body style="margin:0;padding:40px">
  <input id="prima" type="text" value="testo di prima" style="${CAMPO}">
  <input id="segreta" type="password" value="segreta123" style="${CAMPO}">
  <textarea id="area" style="${CAMPO};height:50px">tieni taglia questo resta</textarea>
  </body></html>`;

// L'Aiuto risponde con l'azione della pagina che gli si dà, come farebbe il modello davanti a «taglia»; la Modifica
// riscrive sempre allo stesso modo.
async function aiutoCheTaglia(app, pagina) {
  await app.evaluate(async (_electron, pagina) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const aiuto = sistema.includes('# Protocollo di risposta');
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop',
        text: aiuto ? JSON.stringify({ action: 'page', page: pagina, text: 'Ecco.', status: 'done' }) : 'Testo riscritto.',
      };
    };
    P.completeWithFallback = risposta;
    P.streamCompleteWithFallback = risposta;
  }, pagina);
}

async function chiediAFilo(app, shell, page, testo) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  return aiuto;
}

// I passi della segnalazione: tutto selezionato in un campo, tasto destro e Incolla.
async function incollaColTastoDestro(page, sel) {
  const menu = menuDi(page);
  await page.locator(sel).focus();
  await page.keyboard.press('Control+a');
  await page.locator(sel).click({ button: 'right', position: { x: 12, y: 8 } });
  await menu.locator('.sn-menu-paste-main', { hasText: 'Incolla' }).click();
  await expect(page.locator(sel)).toHaveValue('dagli appunti');
}

async function selezionaNellArea(page) {
  await page.locator('#area').focus();
  await page.evaluate(() => {
    const a = document.getElementById('area');
    const i = a.value.indexOf('taglia questo');
    a.setSelectionRange(i, i + 'taglia questo'.length);
  });
}

for (const campo of ['#prima', '#segreta']) {
  test(`dopo Incolla col tasto destro in ${campo === '#prima' ? 'un campo' : 'una password'}, «taglia» chiesto a Filo taglia la selezione di adesso`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, CAMPI);
    await app.evaluate(({ clipboard }) => clipboard.writeText('dagli appunti'));
    await incollaColTastoDestro(page, campo);

    await selezionaNellArea(page);
    await aiutoCheTaglia(app, { op: 'cut', text: 'taglia questo' });
    await chiediAFilo(app, shell, page, 'taglia');

    await expect.poll(() => appunti(app), { timeout: 20_000 }).toBe('taglia questo');
    await expect(page.locator('#area')).toHaveValue('tieni  resta');
    await expect(page.locator(campo)).toHaveValue('dagli appunti');
  });
}

test('dopo Incolla col tasto destro in un campo, «modifica» chiesto a Filo riscrive la selezione di adesso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, CAMPI);
  await app.evaluate(({ clipboard }) => clipboard.writeText('dagli appunti'));
  await incollaColTastoDestro(page, '#prima');

  await selezionaNellArea(page);
  await aiutoCheTaglia(app, { op: 'edit_text', text: 'taglia questo' });
  await chiediAFilo(app, shell, page, 'modifica questo testo');

  await expect.poll(() => statoDi(app, page, '.sn-editbox-instruction'), { timeout: 20_000 }).not.toBeNull();
  const strato = await scrivi(app, page, '.sn-editbox-instruction', 'più formale');
  await strato.keyboard.press('Enter');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.testo || '').toContain('riscritto');
  await clicca(app, page, '.sn-editbox-replace');
  await expect(page.locator('#area')).toHaveValue('tieni Testo riscritto. resta');
  await expect(page.locator('#prima')).toHaveValue('dagli appunti');
});

test('«taglia» chiesto a Filo con una password selezionata non la porta negli appunti, e Filo lo dice', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, CAMPI);
  await app.evaluate(({ clipboard }) => clipboard.writeText('come prima'));
  await page.locator('#segreta').focus();
  await page.keyboard.press('Control+a');
  await aiutoCheTaglia(app, { op: 'cut', text: 'segreta123' });
  const aiuto = await chiediAFilo(app, shell, page, 'taglia');

  await expect(aiuto.locator('.sn-sidebar')).toContainText('un campo password non si taglia', { timeout: 20_000 });
  expect(await appunti(app)).toBe('come prima');
  await expect(page.locator('#segreta')).toHaveValue('segreta123');
});
