// Verifica #810.19 giro 1: il valore che l'utente mette in un campo per strade diverse dai tasti in fondo non resta
// fra i segreti letti, e una proposta lunga dell'assistente non copre i codici letti dopo.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriCronologia } from '../../helpers/cronologiaAppunti.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const CARTA = '4111 1111 1111 1111';
const PASSWORD = 'Zq7#mR42kLp';
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

async function modelloFinto(app, aiuto = '{"text":"Ecco.","status":"done"}') {
  await app.evaluate(async (_e, aiuto) => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts, messages) => {
      const testo = JSON.stringify(messages);
      const sottofondo = testo.includes('preparare la dashboard') ? '{"message":"Bentornato.","suggestions":[]}'
        : (testo.includes('scritto in un campo editabile') ? '{"issues":[]}' : '');
      return { text: sottofondo || aiuto, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
    P.streamCompleteWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
  }, aiuto);
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
  await expect(aiuto.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return aiuto;
}

async function scriviAllAiuto(aiuto, testo) {
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
}

const lettiSalvati = (app) => app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore));
async function lettiDopoUnRiavvio(app) {
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  return (await lettiSalvati(app)).map((v) => v.replace(/[\s-]/g, '').toLowerCase());
}

async function chiediEGuarda(app, shell, page) {
  const aiuto = await apriAiuto(app, shell, page);
  await scriviAllAiuto(aiuto, 'aiutami a finire');
  await expect(aiuto.locator('.sn-sidebar').getByText('Ecco.')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => lettiSalvati(app), { timeout: 10_000 }).toContain('264087');
  const dopo = await lettiDopoUnRiavvio(app);
  expect(dopo).toContain('264087');
  return dopo;
}

const QUATTRO_IN_OMBRA = `<div id="disegno">•••• •••• •••• ••••</div><label>Numero della carta</label><span id="ospite"></span>
  <script>var r=document.getElementById('ospite').attachShadow({mode:'open'});
  r.innerHTML='<input id="c1" maxlength="4"><input id="c2" maxlength="4"><input id="c3" maxlength="4"><input id="c4" maxlength="4">';
  var cc=[1,2,3,4].map(function(i){return r.getElementById('c'+i);});
  cc.forEach(function(x,i){x.addEventListener('input',function(){
  document.getElementById('disegno').textContent=cc.map(function(y){return y.value||'••••';}).join(' ');
  if(x.value.length===4&&cc[i+1])cc[i+1].focus();});});</script>`;

for (const [come, corpo, scrivi, valore] of [
  ['la carta corretta in mezzo a una mail, con la firma ritoccata dopo',
    '<div id="ed" contenteditable="true" style="min-height:80px;border:1px solid">Ciao Marco,<br><span id="qui"></span><br>A presto, Giulia</div>',
    async (page) => {
      await page.locator('#ed').click();
      await page.evaluate(() => { const r = document.createRange(); r.setStart(document.getElementById('qui'), 0); getSelection().removeAllRanges(); getSelection().addRange(r); });
      await page.keyboard.type('la carta è 4111 1111 1121 1111');
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('1');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' Rossi');
      await expect(page.locator('#ed')).toContainText(`la carta è ${CARTA}`);
      await expect(page.locator('#ed')).toContainText('Giulia Rossi');
    }, CARTA],
  ['la carta in quattro caselle dentro un componente, con una cifra corretta nella seconda', QUATTRO_IN_OMBRA, async (page) => {
    await page.locator('#c1').click();
    await page.keyboard.type('4532015912830366', { delay: 20 });
    await page.locator('#c2').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('1');
    await expect(page.locator('#disegno')).toHaveText('4532 0151 1283 0366');
  }, '4532 0151 1283 0366'],
  ['l’IBAN scritto dopo il prefisso IT che il sito mostra accanto al campo',
    '<label for="i">IBAN</label> <span class="pref">IT</span><input id="i">', async (page) => {
      await page.locator('#i').click();
      await page.keyboard.type('60X0542811101000000123456');
      await expect(page.locator('#i')).toHaveValue('60X0542811101000000123456');
    }, 'IT60X0542811101000000123456'],
]) {
  test(`${come} non resta fra i segreti letti`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await testServer.openReady(openTab, PAGAMENTO(corpo));
    await oltreLAvviso(app);
    await preparaModelli(app);
    await modelloFinto(app);
    await scrivi(page);
    const dopo = await chiediEGuarda(app, shell, page);
    const v = valore.replace(/ /g, '').toLowerCase();
    expect(dopo.filter((x) => x.length >= 4 && (v.includes(x) || x.includes(v))), 'il valore dell’utente o un suo pezzo è rimasto fra i segreti letti').toEqual([]);
  });
}

test('la password incollata dalla cronologia degli appunti di Filo non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async (_e, testi) => {
    const MSG = globalThis.SN_MSG.MSG;
    for (const t of testi) {
      await globalThis.SN_HANDLE_MESSAGE({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry: { type: 'text', text: t } }, { url: 'filo://security/security.html' });
    }
  }, [PASSWORD, 'una frase qualunque copiata dopo']);
  const page = await testServer.openReady(openTab, PAGAMENTO('<label for="p">Password:</label><input id="p" type="password">'));
  await oltreLAvviso(app);
  await preparaModelli(app);
  await modelloFinto(app);
  const { voci } = await apriCronologia(app, page, '#p');
  const voce = voci.find((v) => v.testo === PASSWORD);
  expect(voce, 'la password è nella cronologia').toBeTruthy();
  await page.mouse.click(voce.incolla.x, voce.incolla.y);
  await expect(page.locator('#p')).toHaveValue(PASSWORD);
  const dopo = await chiediEGuarda(app, shell, page);
  expect(dopo, 'la password incollata è rimasta fra i segreti letti').not.toContain(PASSWORD.toLowerCase());
});

test('centomila codici in righe corte proposti dall’assistente, senza Accetta, non coprono il codice letto dopo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const righe = Array.from({ length: 100_000 }, (_, i) => String(100000 + i));
  const codice = '153829';
  const giochi = await testServer.openReady(openTab, '<!doctype html><html><head><title>Giochi</title></head><body><textarea id="risposta"></textarea></body></html>');
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Ti preparo le note.', status: 'done', highlight: { selector: '#risposta', action: 'fill', value: righe.join('\n'), note: 'Note' } }));
  const aiuto = await apriAiuto(app, shell, giochi);
  await scriviAllAiuto(aiuto, 'cosa scrivo nelle note?');
  await expect(aiuto.locator('.sn-highlight-value')).toContainText('100000', { timeout: 60_000 });
  await giochi.waitForTimeout(1000);
  const banca = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head><body>
    <p>Il tuo codice di recupero è ${codice}. Non darlo a nessuno.</p></body></html>`, { pubblico: true });
  await modelloFinto(app);
  const aiuto2 = await apriAiuto(app, shell, banca);
  await scriviAllAiuto(aiuto2, 'cosa devo fare?');
  await expect.poll(() => lettiSalvati(app), { timeout: 20_000 }).toContain(codice);
});
