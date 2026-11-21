// #2641 giro 1: la password proposta dall'assistente e accettata resta dell'utente anche se lui scrive all'Aiuto
// subito dopo l'Accetta, prima che la pagina abbia detto al main cosa ha immesso. Si guarda il registro appena arriva
// la risposta, senza il riavvio che dà tempo al ritardo.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const PROPOSTA = 'Rk8$vN3qLzW2';
const ACCESSO = `<!doctype html><html><head><title>Accedi</title></head><body style="padding:40px;font:16px sans-serif">
  <h1>Accedi</h1><form><label for="rec">Codice di recupero:</label><input id="rec">
  <script>document.getElementById('rec').value = '731954';</script><br>
  <label for="p">Password:</label><input id="p" type="password"><br><button type="button">Entra</button></form></body></html>`;

async function prepara(app) {
  await app.evaluate(async (_e, proposta) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const testo = JSON.stringify(messages);
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      let text = '{"text":"Ecco.","status":"done"}';
      if (testo.includes('preparare la dashboard')) text = '{"message":"Bentornato.","suggestions":[]}';
      else if (testo.includes('scritto in un campo editabile')) text = '{"issues":[]}';
      else if (ultimo.includes('e adesso')) text = '{"text":"Premi Entra.","status":"done"}';
      else text = JSON.stringify({ text: 'Ti propongo questa.', status: 'done', highlight: { selector: '#p', action: 'fill', value: proposta, note: 'Password nuova' } });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (a) => risposta(a);
    P.streamCompleteWithFallback = async (a) => risposta(a);
  }, PROPOSTA);
}

for (let giro = 1; giro <= 4; giro++) {
  test(`accetta e scrivi subito all’Aiuto: la password proposta non entra fra i segreti letti (${giro})`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, ACCESSO);
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      const t = tm.tabs.find((x) => /^https?:/.test(x.url));
      tm.safebrowseDismiss(t.id, t.url);
    });
    await prepara(app);
    const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
    await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
    const aiuto = await paginaDellAiuto(app, page);
    await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
    await aiuto.fill('.sn-sidebar-input textarea', 'scegli tu una password');
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    const accetta = aiuto.locator('.sn-highlight-accept');
    await accetta.waitFor({ timeout: 20_000 });
    // Subito: la domanda è già scritta, e Invio arriva appena dopo l'Accetta, come chi preme di slancio.
    await aiuto.fill('.sn-sidebar-input textarea', 'e adesso?');
    await accetta.click();
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    await expect(aiuto.locator('.sn-sidebar').getByText('Premi Entra.')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#p')).toHaveValue(PROPOSTA);
    const letti = await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore));
    expect(letti).toContain('731954');
    expect(letti, 'la password accettata è fra i segreti letti appena l’Aiuto risponde').not.toContain(PROPOSTA);
  });
}
