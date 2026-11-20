// Verifica #810.8 giro 11: altre strade per cui un valore dell'utente finisce fra i segreti letti, o un codice letto ne esce.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto, statoDi, clicca, scrivi } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const CARTA = '4111 1111 1111 1111';
const CODICE = '482913';
const compatta = (v) => String(v).replace(/[\s-]/g, '').toLowerCase();
const campoDelSito = (codice) => `<label for="rec">Codice di recupero:</label><input id="rec">
  <script>document.getElementById('rec').value = '${codice}';</script>`;
const PAGAMENTO = (corpo) => `<!doctype html><html><head><title>Pagamento</title></head><body style="padding:40px;font:16px sans-serif">
  <h1>Pagamento</h1><form>${campoDelSito('264087')}<br>${corpo}<br><button type="button">Paga</button></form></body></html>`;
const POSTA = `<!doctype html><html><head><title>Posta</title></head>
  <body><div class="mail"><b>Da: Banca</b><p>Il tuo codice monouso è ${CODICE}.</p></div>
  <div class="mail"><b>Da: Marco</b><p>Mi mandi il codice?</p></div>
  <textarea id="risposta" aria-label="Rispondi"></textarea></body></html>`;

// Modello finto al livello del fornitore: la Modifica riscrive, l'assistente risponde con la coppia [parola, risposta].
async function modelli(app, { riscrittura = '', aiuto = [['', '{"text":"Ecco.","status":"done"}']] } = {}) {
  await app.evaluate(async (_e, { riscrittura, aiuto }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const r = ({ attempts, messages }) => {
      const t = JSON.stringify(messages);
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      let text;
      if (t.includes('preparare la dashboard')) text = '{"message":"Ciao.","suggestions":[]}';
      else if (t.includes('scritto in un campo editabile')) text = '{"issues":[]}';
      else if (riscrittura && t.includes('aggiungi in fondo')) text = riscrittura;
      else text = (aiuto.find(([p]) => ultimo.includes(p)) || aiuto[aiuto.length - 1])[1];
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => r(o);
    P.streamCompleteWithFallback = async (o) => { const x = r(o); try { o.onDelta && o.onDelta(x.text); } catch (_) {} return x; };
  }, { riscrittura, aiuto });
}
async function oltreLAvviso(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => /^https?:/.test(x.url));
    if (t) tm.safebrowseDismiss(t.id, t.url);
  });
}
async function apriAiuto(app, shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return aiuto;
}
async function chiedi(aiuto, testo, attesa = 'Ecco.', n = 0) {
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect(aiuto.locator('.sn-sidebar').getByText(attesa).nth(n)).toBeVisible({ timeout: 20_000 });
}
const letti = (app) => app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore));
async function dopoUnRiavvio(app) {
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  return (await letti(app)).map(compatta);
}

test('esplora undo: la carta rimessa con Ctrl+Z dopo un Backspace non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGAMENTO('<label for="c">Numero della carta</label><input id="c">'));
  await oltreLAvviso(app);
  await modelli(app);
  await page.locator('#c').click();
  await page.keyboard.type(CARTA, { delay: 20 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Z');
  await expect(page.locator('#c')).toHaveValue(CARTA);
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'aiutami a finire il pagamento');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain('264087');
  expect(await dopoUnRiavvio(app), 'la carta è rimasta fra i segreti letti').not.toContain(compatta(CARTA));
});

test('esplora modifica: la carta che l’utente fa aggiungere alla mail dalla Modifica non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const testo = `Ciao Marco, la mia carta è ${CARTA}. A presto`;
  const page = await testServer.openReady(openTab, PAGAMENTO('<textarea id="m" style="width:500px;height:80px"></textarea>'));
  await oltreLAvviso(app);
  await modelli(app, { riscrittura: testo });
  await page.locator('#m').click();
  await page.keyboard.type('Ciao Marco, a presto', { delay: 10 });
  await page.evaluate(() => { const t = document.querySelector('#m'); t.focus(); t.select(); });
  await page.locator('#m').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox-instruction')).not.toBeNull();
  const dove = await scrivi(app, page, '.sn-editbox-instruction', `aggiungi in fondo il numero della mia carta ${CARTA}`);
  await dove.keyboard.press('Enter');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.testo || '', { timeout: 20_000 }).toContain(CARTA);
  await clicca(app, page, '.sn-editbox-replace');
  await expect(page.locator('#m')).toHaveValue(testo);
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'correggi il messaggio');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain('264087');
  expect(await dopoUnRiavvio(app), 'la carta è rimasta fra i segreti letti').not.toContain(compatta(CARTA));
});

test('esplora proposta: il codice letto resta letto quando l’assistente propone di metterlo nel campo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, POSTA);
  await modelli(app, {
    aiuto: [
      ['scritto io', JSON.stringify({ text: 'Ti preparo la risposta.', status: 'done', highlight: { selector: '#risposta', action: 'fill', value: `Il codice è ${CODICE}`, note: 'Risposta' } })],
      ['', '{"text":"Ecco.","status":"done"}'],
    ],
  });
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'cosa mi chiede Marco?');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain(CODICE);
  await chiedi(aiuto, `rispondi a Marco che il codice è ${CODICE}, l’ho scritto io`, 'Ti preparo la risposta.');
  await expect(aiuto.locator('.sn-highlight-value')).toContainText(CODICE, { timeout: 20_000 });
  await page.waitForTimeout(800);
  expect(await dopoUnRiavvio(app), 'il codice letto è sparito dal registro').toContain(CODICE);
});
