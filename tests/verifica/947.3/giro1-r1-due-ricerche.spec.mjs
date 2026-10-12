// Verifica #947.3 giro 1: dopo una seconda ricerca nella stessa conversazione dell'Aiuto, il bottone del documento
// trovato con la prima deve ancora aprirlo (e trascinarlo): è lo stesso file, ancora lì.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { cartellaDellaProva, BOLLETTA_MARZO } from '../../helpers/documentiFinti.mjs';
import { confermaSopraPagina, clickConfirm } from '../../helpers/confirm.mjs';

const PAGINA = `<!doctype html><html><head><title>Fornitore Energia</title></head>
<body style="padding:40px;font:16px sans-serif"><h1>Carica la tua bolletta</h1>
<form><label>Bolletta <input type="file" id="bolletta"></label><button>Invia</button></form></body></html>`;

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

async function aiutoFinto(app, risposte) {
  await app.evaluate((_e, risposte) => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { text: '{"message":"Ciao.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = risposte.find(([parola]) => ultimo.includes(parola)) || risposte[risposte.length - 1];
      return { text: scelta[1], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  }, risposte);
}

test('r1 il bottone della prima ricerca apre ancora il suo documento dopo una seconda ricerca', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'DueRicerche');
  cartellaDellaProva(dir);
  try {
    const page = await testServer.openReady(openTab, PAGINA);
    await preparaModelli(app);
    await aiutoFinto(app, [
      ['ho cercato fra i documenti', JSON.stringify({ text: 'Ecco il documento.', file: 1, status: 'done' })],
      ['gas', JSON.stringify({ action: 'documenti', cosa: 'bolletta gas marzo' })],
      ['', JSON.stringify({ action: 'documenti', cosa: 'bolletta luce energia elettrica marzo' })],
    ]);
    await app.evaluate(({ shell: s }) => {
      globalThis.__aperti = [];
      s.openPath = async (p) => { globalThis.__aperti.push(p); return ''; };
    });
    const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
    await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
    await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });

    await page.fill('.sn-sidebar-input textarea', 'mi serve la bolletta della luce di marzo');
    await page.press('.sn-sidebar-input textarea', 'Enter');
    await clickConfirm(await confermaSopraPagina(app, { timeout: 20_000 }), 'ok');
    const file = page.locator('.sn-sidebar .sn-sidebar-file');
    await expect(file).toHaveCount(1, { timeout: 20_000 });
    await expect(file.first().locator('.sn-sidebar-file-nome')).toHaveText(BOLLETTA_MARZO);

    await page.fill('.sn-sidebar-input textarea', 'e quella del gas?');
    await page.press('.sn-sidebar-input textarea', 'Enter');
    await clickConfirm(await confermaSopraPagina(app, { timeout: 20_000 }), 'ok');
    await expect(file).toHaveCount(2, { timeout: 20_000 });

    // Il primo bottone, quello della luce di marzo, è ancora in chat e l'utente lo clicca.
    await file.first().click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti), { timeout: 5_000 }).toEqual([join(dir, BOLLETTA_MARZO)]);
    await expect(page.locator('.sn-sidebar-log', { hasText: 'non c’è più' })).toHaveCount(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
