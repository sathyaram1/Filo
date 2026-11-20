// Aiuti delle prove di verifica di #810.8: modello finto, assistente di pagina, registro dei segreti letti.
import { expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

export const CARTA = '4111 1111 1111 1111';
export const CODICE = '482913';
export const compatta = (v) => String(v).replace(/[\s-]/g, '').toLowerCase();
const campoDelSito = (codice) => `<label for="rec">Codice di recupero:</label><input id="rec">
  <script>document.getElementById('rec').value = '${codice}';</script>`;
export const PAGAMENTO = (corpo) => `<!doctype html><html><head><title>Pagamento</title></head><body style="padding:40px;font:16px sans-serif">
  <h1>Pagamento</h1><form>${campoDelSito('264087')}<br>${corpo}<br><button type="button">Paga</button></form></body></html>`;
export const POSTA = `<!doctype html><html><head><title>Posta</title></head>
  <body><div class="mail"><b>Da: Banca</b><p>Il tuo codice monouso è ${CODICE}.</p></div>
  <div class="mail"><b>Da: Marco</b><p>Mi mandi il codice?</p></div>
  <textarea id="risposta" aria-label="Rispondi"></textarea></body></html>`;

// Modello finto: la Modifica riscrive con `riscrittura`, l'assistente risponde con la prima coppia [parola, risposta].
export async function modelli(app, { riscrittura = '', aiuto = [['', '{"text":"Ecco.","status":"done"}']] } = {}) {
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

// Un modulo su una pagina senza https porta l'avviso del sito sospetto: si va avanti come con «Continua».
export async function oltreLAvviso(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => /^https?:/.test(x.url));
    if (t) tm.safebrowseDismiss(t.id, t.url);
  });
}

export async function apriAiuto(app, shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return aiuto;
}

export async function chiedi(aiuto, testo, attesa = 'Ecco.') {
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  if (attesa) await expect(aiuto.locator('.sn-sidebar').getByText(attesa).first()).toBeVisible({ timeout: 20_000 });
}

export const letti = (app) => app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore));
// Come a un riavvio: il registro si rilegge da quello che ha salvato su disco.
export async function dopoUnRiavvio(app) {
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  return (await letti(app)).map(compatta);
}
