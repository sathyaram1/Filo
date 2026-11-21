// Aiuti delle prove di #810.19: una pagina di pagamento col codice scritto dal sito, il modello finto, l'Aiuto aperto
// e il registro dei segreti letti riletto come dopo un riavvio.
import { expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const campoDelSito = (codice) => `<label for="rec">Codice di recupero:</label><input id="rec">
  <script>document.getElementById('rec').value = '${codice}';</script>`;
export const PAGAMENTO = (corpo) => `<!doctype html><html><head><title>Pagamento</title></head><body style="padding:40px;font:16px sans-serif">
  <h1>Pagamento</h1><form>${campoDelSito('264087')}<br>${corpo}<br><button type="button">Paga</button></form></body></html>`;

export async function preparaModelli(app) {
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

export async function modelloFinto(app, aiuto = '{"text":"Ecco.","status":"done"}') {
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
  await expect(aiuto.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return aiuto;
}

export async function scriviAllAiuto(aiuto, testo) {
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
}

export const lettiSalvati = (app) => app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore));

// Chiede aiuto sulla pagina e torna il registro riletto da disco, compattato, quando la lettura è finita.
export async function chiediEGuarda(app, shell, page) {
  const aiuto = await apriAiuto(app, shell, page);
  await scriviAllAiuto(aiuto, 'aiutami a finire');
  await expect(aiuto.locator('.sn-sidebar').getByText('Ecco.')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => lettiSalvati(app), { timeout: 10_000 }).toContain('264087');
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  const dopo = (await lettiSalvati(app)).map((v) => v.replace(/[\s-]/g, '').toLowerCase());
  expect(dopo).toContain('264087');
  return dopo;
}
