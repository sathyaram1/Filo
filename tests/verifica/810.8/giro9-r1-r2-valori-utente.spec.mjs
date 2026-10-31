// Verifica #810.8 giro 9: un valore che l'utente mette nel campo per una strada che il sito trattiene resta suo (r1);
// il testo di una proposta dell'assistente non copre senza limite i codici letti dopo su un altro sito (r2).
import { test, expect } from '../../fixtures/electron.mjs';

const CARTA_UTENTE = '4111 1111 1111 1111';
const campoDelSito = (codice) => `<label for="rec">Codice di recupero:</label><input id="rec">
  <script>document.getElementById('rec').value = '${codice}';</script>`;
const PAGAMENTO = (corpo) => `<!doctype html><html><head><title>Pagamento</title></head><body style="padding:40px;font:16px sans-serif">
  <h1>Pagamento</h1><form>${campoDelSito('264087')}<br>${corpo}<br><button type="button">Paga</button></form></body></html>`;

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}
// L'assistente risponde con la prima coppia [parola, risposta] la cui parola sta nell'ultimo messaggio dell'utente.
async function modelloFinto(app, aiuto = [['', '{"text":"Ecco.","status":"done"}']]) {
  await app.evaluate(async (_electron, risposte) => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts, messages) => {
      const testo = JSON.stringify(messages);
      const sottofondo = testo.includes('preparare la dashboard') ? '{"message":"Bentornato.","suggestions":[]}'
        : (testo.includes('scritto in un campo editabile') ? '{"issues":[]}' : '');
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = sottofondo || (risposte.find(([parola]) => ultimo.includes(parola)) || risposte[risposte.length - 1])[1];
      return { text: scelta, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
    P.streamCompleteWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
  }, aiuto);
}
async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}
async function scriviAllAiuto(page, testo) {
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}
async function oltreLAvviso(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => /^https?:/.test(x.url));
    if (t) tm.safebrowseDismiss(t.id, t.url);
  });
}
const lettiSalvati = (app) => app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore));
async function lettiDopoUnRiavvio(app) {
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  return lettiSalvati(app);
}

const QUATTRO = `<div id="disegno">•••• •••• •••• ••••</div><label>Numero della carta</label>
  <input id="c1" maxlength="4"><input id="c2" maxlength="4"><input id="c3" maxlength="4"><input id="c4" maxlength="4">
  <script>var cc=[1,2,3,4].map(function(i){return document.getElementById('c'+i);});
  function ridisegna(){document.getElementById('disegno').textContent=cc.map(function(x){return x.value||'••••';}).join(' ');}</script>`;

for (const [come, corpo, mette] of [
  ['incollato in un campo che pulisce da sé l’incolla', `<label for="c">Numero della carta</label><input id="c" autocomplete="cc-number">
    <script>var c=document.getElementById('c');c.addEventListener('paste',function(e){e.preventDefault();
    var d=e.clipboardData.getData('text').replace(/\\D/g,'').slice(0,16);c.value=d.replace(/(\\d{4})(?=\\d)/g,'$1 ');});</script>`,
  async (app, page) => {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), CARTA_UTENTE.replace(/ /g, ''));
    await page.locator('#c').click();
    await page.keyboard.press('Control+V');
    await expect(page.locator('#c')).toHaveValue(CARTA_UTENTE);
  }],
  ['incollato nella prima di quattro caselle che la pagina distribuisce', `${QUATTRO}<script>cc[0].addEventListener('paste',function(e){e.preventDefault();
    var d=e.clipboardData.getData('text').replace(/\\D/g,'');cc.forEach(function(x,i){x.value=d.slice(i*4,i*4+4);});ridisegna();});</script>`,
  async (app, page) => {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), CARTA_UTENTE);
    await page.locator('#c1').click();
    await page.keyboard.press('Control+V');
    await expect(page.locator('#disegno')).toHaveText(CARTA_UTENTE);
  }],
  ['scritto in quattro caselle che scrivono da sé le cifre', `${QUATTRO}<script>cc.forEach(function(c,i){c.addEventListener('keydown',function(e){
    if(!/^\\d$/.test(e.key))return;e.preventDefault();if(c.value.length<4)c.value+=e.key;ridisegna();if(c.value.length===4&&cc[i+1])cc[i+1].focus();});});</script>`,
  async (_app, page) => {
    await page.locator('#c1').click();
    await page.keyboard.type(CARTA_UTENTE.replace(/ /g, ''), { delay: 20 });
    await expect(page.locator('#disegno')).toHaveText(CARTA_UTENTE);
  }],
]) {
  test(`r1 il numero di carta ${come} non resta fra i segreti letti`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, PAGAMENTO(corpo));
    await oltreLAvviso(app);
    await preparaModelli(app);
    await modelloFinto(app);
    await mette(app, page);
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'aiutami a finire');
    await expect(page.locator('.sn-sidebar').getByText('Ecco.')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => lettiSalvati(app), { timeout: 10_000 }).toContain('264087');
    const dopo = (await lettiDopoUnRiavvio(app)).map((v) => v.replace(/[\s-]/g, ''));
    expect(dopo).toContain('264087');
    expect(dopo, 'il numero della carta è rimasto fra i segreti letti').not.toContain(CARTA_UTENTE.replace(/ /g, ''));
  });
}

// Centomila codici di sei cifre, in righe da meno di 500 caratteri: il decimo di tutti quelli possibili.
const PROPOSTA = (() => {
  const righe = [];
  let riga = [];
  for (let n = 700000; n < 800000; n++) {
    riga.push(String(n));
    if (riga.length === 80) { righe.push(riga.join(' ')); riga = []; }
  }
  if (riga.length) righe.push(riga.join(' '));
  return righe.join('\n');
})();

test('r2 il testo di una proposta dell’assistente non copre i codici che Filo legge dopo su un altro sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await preparaModelli(app);
  await modelloFinto(app, [
    ['cosa devo fare', '{"text":"Ecco.","status":"done"}'],
    ['', JSON.stringify({ text: 'Compilo io le note.', status: 'done', highlight: { selector: '#n', action: 'fill', value: PROPOSTA, note: 'Note' } })],
  ]);
  const sito = await testServer.openReady(openTab, `<!doctype html><html><head><title>Lotteria</title></head><body style="padding:40px">
    <h1>Estrazioni</h1><label for="n">Note</label><textarea id="n"></textarea></body></html>`);
  await apriAiuto(shell, sito);
  await scriviAllAiuto(sito, 'compila le note');
  await sito.locator('.sn-highlight-accept').click({ timeout: 30_000 });
  await expect.poll(() => sito.locator('#n').evaluate((t) => t.value.length), { timeout: 10_000 }).toBeGreaterThan(500_000);

  const banca = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head><body>${campoDelSito('731942')}</body></html>`);
  await apriAiuto(shell, banca);
  await scriviAllAiuto(banca, 'cosa devo fare?');
  await expect(banca.locator('.sn-sidebar').getByText('Ecco.')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => lettiSalvati(app), { timeout: 10_000 }).toContain('731942');
  expect(await lettiDopoUnRiavvio(app)).toContain('731942');
});
