// Esplorazione: quali chiamate al modello arrivano al finto durante il flusso dell'Aiuto con la carta, oltre ai turni.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const modulo = (campo) => `<!doctype html><html><head><title>Accesso</title></head><body><h1>Area clienti</h1>
  <form><div>${campo}</div><button type="button">Accedi</button></form></body></html>`;

for (let k = 0; k < 4; k++) {
  test(`chiamate extra ${k}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await testServer.openReady(openTab, modulo('<fieldset><legend>Carta di credito</legend><label for="c">Numero</label> '
      + '<input id="c" name="number" style="width:300px;font-size:18px;outline:0;caret-color:transparent"></fieldset>'));
    await app.evaluate(async () => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash', [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
    });
    await app.evaluate(() => {
      const P = globalThis.SN_PROVIDERS;
      globalThis.__visti = [];
      const finto = async ({ attempts, messages }) => {
        globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
        return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: JSON.stringify({ text: 'Premi «Accedi».', status: 'done' }) };
      };
      P.completeWithFallback = finto;
      P.streamCompleteWithFallback = finto;
    });
    const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
    await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
    const aiuto = await paginaDellAiuto(app, page);
    await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
    for (const v of ['4111 1111 1111 1111', '5500 0000 0000 0004']) {
      await page.fill('#c', v);
      await aiuto.fill('.sn-sidebar-input textarea', 'aiutami a pagare');
      await aiuto.press('.sn-sidebar-input textarea', 'Enter');
      await page.waitForTimeout(3000);
    }
    const riassunto = await app.evaluate(() => globalThis.__visti.map((ms) => {
      const u = [...ms].reverse().find((m) => m.role === 'user');
      const t = Array.isArray(u?.content) ? u.content.filter((p) => p.type === 'text').map((p) => p.text).join(' ') : String(u?.content || '');
      return { n: ms.length, sistema: String((ms.find((m) => m.role === 'system') || {}).content || '').slice(0, 120), utente: t.slice(0, 300), carta: /4111|5500/.test(JSON.stringify(ms)) };
    }));
    console.log('CHIAMATE', JSON.stringify(riassunto, null, 1));
    expect(riassunto.length).toBeGreaterThan(0);
  });
}
