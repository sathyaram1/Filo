// Verifica #810.8 giro 5: un valore dell'utente che arriva nel campo senza i suoi tasti in fila, o mescolato a testo
// che non ha scritto, non deve restare fra i segreti letti dalla pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const IBAN = 'IT60X0542811101000000123456';
const CARTA = '4111 1111 1111 1111';
const PASSWORD = 'Zq7#mR42kLp';
const campoDelSito = (codice) => `<label for="rec">Codice di recupero:</label><input id="rec">
  <script>document.getElementById('rec').value = '${codice}';</script>`;
const pagina = (titolo, corpo) => `<!doctype html><html><head><title>${titolo}</title></head><body style="padding:40px;font:16px sans-serif">
  <h1>${titolo}</h1><form>${campoDelSito('731954')}<br>${corpo}<br><button type="button">Invia</button></form></body></html>`;

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts, messages) => {
      const testo = JSON.stringify(messages);
      const text = testo.includes('preparare la dashboard') ? '{"message":"Ciao.","suggestions":[]}'
        : (testo.includes('scritto in un campo editabile') ? '{"issues":[]}' : '{"text":"Ecco.","status":"done"}');
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
    P.streamCompleteWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
  });
}

async function oltreLAvviso(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => /^https?:/.test(x.url));
    tm.safebrowseDismiss(t.id, t.url);
  });
}

async function chiediAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await page.fill('.sn-sidebar-input textarea', 'aiutami a finire');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar').getByText('Ecco.')).toBeVisible({ timeout: 20_000 });
}

const compatti = (lista) => lista.map((v) => v.replace(/[\s-]/g, '').toLowerCase());
async function lettiDopoUnRiavvio(app) {
  await expect.poll(() => app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore)), { timeout: 10_000 }).toContain('731954');
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  return compatti(await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore)));
}

test('r1 la password incollata dal tasto destro di Filo non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('Accedi', '<label for="p">Password:</label><input id="p" type="password">'));
  await oltreLAvviso(app);
  await preparaModelli(app);
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), PASSWORD);
  await page.locator('#p').click({ button: 'right' });
  await menuDi(page).locator('.sn-menu-paste-main').click();
  await expect(page.locator('#p')).toHaveValue(PASSWORD);
  await chiediAiuto(shell, page);
  expect(await lettiDopoUnRiavvio(app), 'la password incollata è rimasta fra i segreti letti').not.toContain(PASSWORD.toLowerCase());
});

test('r1 l’IBAN scritto dopo il prefisso messo dal sito non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('Bonifico', '<label for="i">IBAN</label><input id="i" value="IT">'));
  await preparaModelli(app);
  await page.locator('#i').click();
  await page.keyboard.press('End');
  await page.keyboard.type(IBAN.slice(2));
  await expect(page.locator('#i')).toHaveValue(IBAN);
  await chiediAiuto(shell, page);
  expect(await lettiDopoUnRiavvio(app), 'l’IBAN è rimasto fra i segreti letti').not.toContain(IBAN.toLowerCase());
});

test('r1 la carta corretta in mezzo a una mail con saluto e firma non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('Posta',
    '<div id="ed" contenteditable="true" style="min-height:80px;border:1px solid">Ciao Marco,<br><span id="qui"></span><br>A presto, Giulia</div>'));
  await preparaModelli(app);
  await page.locator('#ed').click();
  await page.evaluate(() => { const r = document.createRange(); r.setStart(document.getElementById('qui'), 0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); });
  await page.keyboard.type('la carta è 4111 1111 1121 1111');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('1');
  await expect(page.locator('#ed')).toContainText(`la carta è ${CARTA}`);
  await chiediAiuto(shell, page);
  expect(await lettiDopoUnRiavvio(app), 'la carta corretta è rimasta fra i segreti letti').not.toContain(CARTA.replace(/ /g, ''));
});

test('r1 l’IBAN dentro una lettera lunga che l’utente incolla non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const lettera = `Gentile ufficio,\n${'vi scrivo per il rimborso della fattura di marzo, che non ho ancora ricevuto. '.repeat(16)}\nIl mio IBAN è ${IBAN}.\nCordiali saluti, Giulia Rossi`;
  expect(lettera.length).toBeGreaterThan(1000);
  const page = await testServer.openReady(openTab, pagina('Contatti', '<label for="m">Messaggio</label><textarea id="m" rows="8" cols="60"></textarea>'));
  await preparaModelli(app);
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), lettera);
  await page.locator('#m').click();
  await page.keyboard.press('Control+V');
  await expect(page.locator('#m')).toHaveValue(lettera);
  await chiediAiuto(shell, page);
  expect(await lettiDopoUnRiavvio(app), 'l’IBAN della lettera è rimasto fra i segreti letti').not.toContain(IBAN.toLowerCase());
});
