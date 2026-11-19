// Verifica #810.8 giro 10: il valore che l'utente mette nella pagina non resta fra i segreti letti, per strade nuove.
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const CARTA = '4111 1111 1111 1111';
const compatta = (v) => v.replace(/[\s-]/g, '').toLowerCase();
const campoDelSito = (codice) => `<label for="rec">Codice di recupero:</label><input id="rec">
  <script>document.getElementById('rec').value = '${codice}';</script>`;
const campoCarta = '<label for="c">Numero della carta</label><input id="c" autocomplete="cc-number">';

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
    for (const t of tm.tabs.filter((x) => /^https?:/.test(x.url))) tm.safebrowseDismiss(t.id, t.url);
  });
}
async function chiediAiuto(app, shell, page, testo = 'aiutami a finire') {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect(aiuto.locator('.sn-sidebar').getByText('Ecco.').last()).toBeVisible({ timeout: 20_000 });
}
const lettiDopoUnRiavvio = async (app) => {
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  return (await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore))).map(compatta);
};
async function controlla(app, sentinella, valore) {
  await expect.poll(async () => (await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore))), { timeout: 10_000 }).toContain(sentinella);
  const dopo = await lettiDopoUnRiavvio(app);
  expect(dopo).toContain(sentinella);
  expect(dopo, 'il valore dell’utente è rimasto fra i segreti letti').not.toContain(compatta(valore));
}

test('carta scritta nel riquadro di pagamento di un altro sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const riquadro = testServer.html(`<!doctype html><html><body>${campoCarta}</body></html>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <h1>Pagamento</h1>${campoDelSito('264087')}<br><iframe id="f" src="${riquadro}" style="width:520px;height:90px;border:0"></iframe></body></html>`);
  await oltreLAvviso(app);
  await preparaModelli(app);
  const campo = page.frameLocator('#f').locator('#c');
  await campo.click();
  await campo.pressSequentially(CARTA);
  await expect(campo).toHaveValue(CARTA);
  await chiediAiuto(app, shell, page);
  await controlla(app, '264087', CARTA);
});

test('carta scritta nel modulo e mostrata nel riepilogo della pagina dopo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const riepilogo = testServer.html(`<!doctype html><html><head><title>Riepilogo</title></head><body><h1>Riepilogo</h1>
    <p>Carta: <span id="r"></span></p>${campoDelSito('264087')}
    <script>document.getElementById('r').textContent = sessionStorage.getItem('carta');</script></body></html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <h1>Pagamento</h1>${campoCarta}<button id="av" type="button"
    onclick="sessionStorage.setItem('carta', document.getElementById('c').value); location.href='${riepilogo}'">Continua</button></body></html>`);
  await oltreLAvviso(app);
  await preparaModelli(app);
  await page.locator('#c').pressSequentially(CARTA);
  await page.locator('#av').click();
  await page.waitForURL(riepilogo);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect(page.locator('#r')).toHaveText(CARTA);
  await oltreLAvviso(app);
  await chiediAiuto(app, shell, page, 'è giusto il numero della carta?');
  await controlla(app, '264087', CARTA);
});

test('carta in una bozza che il sito rimette dopo un riavvio di Filo', async () => {
  test.setTimeout(150_000);
  const corpo = `<!doctype html><html><head><title>Posta</title></head><body><h1>Nuovo messaggio</h1>
    ${campoDelSito('264087')}<br><label for="m">Messaggio</label><textarea id="m" rows="6" cols="60"></textarea>
    <script>var m=document.getElementById('m');m.value=localStorage.getItem('bozza')||'';m.addEventListener('input',function(){localStorage.setItem('bozza',m.value);});</script></body></html>`;
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(corpo); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/posta`;
  const userData = cartellaTemporanea('filo-bozza-');
  const launch = () => electron.launch({
    args: [...argomentiScala, '.'], cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const apri = async (app) => {
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await shell.waitForTimeout(1500);
    const gia = await shell.evaluate(async (u) => ((await window.filoShell.tabs.snapshot()).tabs || []).find((t) => t.url === u), url);
    let id = gia && gia.id;
    if (id) await shell.evaluate((x) => window.filoShell.tabs.activate(x), id);
    else id = (await shell.evaluate((u) => window.filoShell.tabs.open(u), url)).id;
    let page = null;
    await expect.poll(async () => Boolean(page = await paginaDellaScheda(app, id, (w) => w.url() === url)), { timeout: 15_000 }).toBe(true);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    return { shell, page };
  };
  let app = await launch();
  try {
    const { page } = await apri(app);
    await page.locator('#m').click();
    await page.keyboard.type(`Ciao Marco, la carta è ${CARTA}.`);
    await page.waitForTimeout(500);
  } finally { await chiudiApp(app); }
  app = await launch();
  try {
    const { shell, page } = await apri(app);
    await expect(page.locator('#m')).toHaveValue(`Ciao Marco, la carta è ${CARTA}.`);
    await preparaModelli(app);
    await chiediAiuto(app, shell, page, 'correggi il messaggio');
    await controlla(app, '264087', CARTA);
  } finally {
    await chiudiApp(app);
    server.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
