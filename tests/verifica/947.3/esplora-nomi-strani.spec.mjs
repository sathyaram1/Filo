// Esplorazione (giro 2): un documento dal nome con markup, emoji e lunghissimo, trovato dall'Aiuto di un sito.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { pdf } from '../../helpers/documentiFinti.mjs';
import { confermaSopraPagina, clickConfirm } from '../../helpers/confirm.mjs';

const PAGINA = `<!doctype html><html><head><title>Fornitore Energia</title></head>
<body style="padding:40px;font:16px sans-serif"><h1>Carica la tua bolletta</h1>
<form><label>Bolletta <input type="file" id="bolletta"></label><button>Invia</button></form></body></html>`;

const NOME = `<img src=x onerror="window.__xss=1"> bolletta luce 😀 ${'molto lungo '.repeat(12)}.pdf`;

test('nome strano', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Strani');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, NOME), pdf([['Bolletta per la fornitura di energia elettrica', 'Periodo di fatturazione: 01/03/2026 - 31/03/2026']]));
  writeFileSync(join(dir, 'altro.pdf'), pdf([['Bolletta luce', 'Periodo di fatturazione: 01/02/2026 - 28/02/2026']]));
  try {
    const page = await testServer.openReady(openTab, PAGINA);
    await app.evaluate(async () => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
        models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
      const P = globalThis.SN_PROVIDERS;
      const risposta = ({ attempts, messages }) => {
        const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
        if (!sistema.includes('# Protocollo di risposta')) return { text: '{"message":"Ciao.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
        const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
        const t = ultimo.includes('ho cercato fra i documenti')
          ? JSON.stringify({ text: 'Eccole.', file: [1, 2], status: 'done' })
          : JSON.stringify({ action: 'documenti', cosa: 'bolletta luce marzo <b>x</b> 😀' });
        return { text: t, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      };
      P.completeWithFallback = async (o) => risposta(o);
      P.streamCompleteWithFallback = async (o) => risposta(o);
    });
    const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
    await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
    await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
    await page.fill('.sn-sidebar-input textarea', 'mi serve la bolletta della luce');
    await page.press('.sn-sidebar-input textarea', 'Enter');
    await clickConfirm(await confermaSopraPagina(app, { timeout: 20_000 }), 'ok');
    const file = page.locator('.sn-sidebar .sn-sidebar-file');
    await expect(file).toHaveCount(2, { timeout: 20_000 });
    await expect(file.first().locator('.sn-sidebar-file-nome')).toHaveText(NOME);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator('.sn-sidebar img').count()).toBe(0);
    await page.screenshot({ path: 'tests/.shots/v947-3-strani.png' });
    await app.evaluate((_e) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'tests/.shots/v947-3-strani-scuro.png' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
