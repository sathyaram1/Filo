// Giro 8 di #810.8: un valore che l'utente immette non resta fra i segreti letti, anche nelle forme di modulo comuni.
import { test, expect } from '../../fixtures/electron.mjs';

const CARTA = '4111 1111 1111 1111';
const CODICE_SITO = '264087';
const campoDelSito = `<label for="rec">Codice di recupero:</label><input id="rec"><script>document.getElementById('rec').value='${CODICE_SITO}';</script>`;
const pagina = (corpo) => `<!doctype html><html><head><title>Pagamento</title></head><body style="padding:40px;font:16px sans-serif">
  <h1>Pagamento</h1><form>${campoDelSito}<br>${corpo}<br><button type="button">Paga</button></form></body></html>`;

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
    const r = ({ attempts, messages }) => {
      const t = JSON.stringify(messages);
      const text = t.includes('preparare la dashboard') ? '{"message":"Ciao.","suggestions":[]}'
        : (t.includes('scritto in un campo editabile') ? '{"issues":[]}' : '{"text":"Ecco.","status":"done"}');
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => r(o);
    P.streamCompleteWithFallback = async (o) => r(o);
  });
}
async function oltreLAvviso(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => /^https?:/.test(x.url));
    if (t) tm.safebrowseDismiss(t.id, t.url);
  });
}
async function chiediAiuto(shell, page, testo) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar').getByText('Ecco.')).toBeVisible({ timeout: 20_000 });
}
const lettiDopoUnRiavvio = async (app) => {
  await expect.poll(() => app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore)), { timeout: 10_000 }).toContain(CODICE_SITO);
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  return (await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore))).map((v) => v.replace(/[\s-]/g, '').toLowerCase());
};

const EDITOR_IFRAME = `<label>Messaggio</label><iframe id="ed" style="width:600px;height:120px;border:1px solid"></iframe>
  <script>var d=document.getElementById('ed').contentDocument;d.open();d.write('<html><body contenteditable="true" style="font:15px sans-serif"><p>Ciao Marco,</p></body></html>');d.close();</script>`;
const CAMPI_DIVISI = `<div id="disegno">•••• •••• •••• ••••</div><label>Numero della carta</label>
  <input id="c1" size="4" maxlength="4"><input id="c2" size="4" maxlength="4"><input id="c3" size="4" maxlength="4"><input id="c4" size="4" maxlength="4">
  <script>var cc=[1,2,3,4].map(function(i){return document.getElementById('c'+i);});
  cc.forEach(function(c,i){c.addEventListener('input',function(){document.getElementById('disegno').textContent=cc.map(function(x){return x.value||'••••';}).join(' ');
  if(c.value.length===4&&cc[i+1])cc[i+1].focus();});});</script>`;

for (const [come, corpo, scrivi, prova] of [
  ['nell’editor di una mail dentro un riquadro', EDITOR_IFRAME, async (page) => {
    const f = page.frameLocator('#ed');
    await f.locator('body').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`la carta è ${CARTA}`);
  }, async (page) => expect(page.frameLocator('#ed').locator('body')).toContainText(CARTA)],
  ['nei quattro campi divisi che la pagina ricompone', CAMPI_DIVISI, async (page) => {
    await page.locator('#c1').click();
    await page.keyboard.type(CARTA.replace(/ /g, ''), { delay: 30 });
  }, async (page) => expect(page.locator('#disegno')).toHaveText(CARTA)],
]) {
  test(`il numero di carta scritto ${come} non resta fra i segreti letti`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, pagina(corpo));
    await oltreLAvviso(app);
    await preparaModelli(app);
    await scrivi(page);
    await prova(page);
    await chiediAiuto(shell, page, 'aiutami a finire');
    expect(await lettiDopoUnRiavvio(app), 'il numero della carta è rimasto fra i segreti letti').not.toContain(CARTA.replace(/ /g, ''));
  });
}

test('il numero di carta scritto nel campo di un altro sito dentro la pagina non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const campo = testServer.html('<!doctype html><html><body><label for="c">Numero della carta</label><input id="c" autocomplete="cc-number"></body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, pagina(`<iframe id="pg" src="${campo}" style="width:520px;height:90px;border:0"></iframe>`));
  await oltreLAvviso(app);
  await preparaModelli(app);
  await page.frameLocator('#pg').locator('#c').pressSequentially(CARTA);
  await expect(page.frameLocator('#pg').locator('#c')).toHaveValue(CARTA);
  await chiediAiuto(shell, page, 'aiutami a finire');
  const dopo = await lettiDopoUnRiavvio(app);
  expect(dopo, 'il numero della carta è rimasto fra i segreti letti').not.toContain(CARTA.replace(/ /g, ''));
});
