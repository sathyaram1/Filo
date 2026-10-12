// Verifica #947.3 giro 2: dopo due ricerche nella stessa conversazione dell'Aiuto il modello ha davanti due elenchi
// di candidati numerati entrambi da 1. Quando indica un documento della prima ricerca col suo numero, il bottone che
// compare deve essere quel documento, non quello che ha lo stesso numero nell'ultima ricerca.

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
    globalThis.__visti = [];
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { text: '{"message":"Ciao.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      globalThis.__visti.push(JSON.stringify(messages));
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = risposte.find(([parola]) => ultimo.includes(parola)) || risposte[risposte.length - 1];
      return { text: scelta[1], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  }, risposte);
}

test('r1 il documento indicato col numero della prima ricerca è quello che compare, anche dopo una seconda ricerca', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'NumeriRipetuti');
  cartellaDellaProva(dir);
  try {
    const page = await testServer.openReady(openTab, PAGINA);
    await preparaModelli(app);
    await aiutoFinto(app, [
      // Il terzo turno: il modello ridà la bolletta della luce col numero che aveva nella prima ricerca.
      ['ridammi', JSON.stringify({ text: 'Ecco di nuovo la bolletta della luce di marzo.', file: 1, status: 'done' })],
      ['ho cercato fra i documenti', JSON.stringify({ text: 'Ecco il documento.', file: 1, status: 'done' })],
      ['gas', JSON.stringify({ action: 'documenti', cosa: 'bolletta gas naturale marzo' })],
      ['', JSON.stringify({ action: 'documenti', cosa: 'bolletta luce energia elettrica marzo' })],
    ]);
    await app.evaluate(({ shell: s }) => { s.openPath = async () => ''; });
    const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
    await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
    await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
    const file = page.locator('.sn-sidebar .sn-sidebar-file');

    await page.fill('.sn-sidebar-input textarea', 'mi serve la bolletta della luce di marzo');
    await page.press('.sn-sidebar-input textarea', 'Enter');
    await clickConfirm(await confermaSopraPagina(app, { timeout: 20_000 }), 'ok');
    await expect(file).toHaveCount(1, { timeout: 20_000 });
    await expect(file.nth(0).locator('.sn-sidebar-file-nome')).toHaveText(BOLLETTA_MARZO);

    await page.fill('.sn-sidebar-input textarea', 'e quella del gas?');
    await page.press('.sn-sidebar-input textarea', 'Enter');
    await clickConfirm(await confermaSopraPagina(app, { timeout: 20_000 }), 'ok');
    await expect(file).toHaveCount(2, { timeout: 20_000 });
    await expect(file.nth(1).locator('.sn-sidebar-file-nome')).toHaveText('doc_8812.pdf');

    await page.fill('.sn-sidebar-input textarea', 'ridammi quella della luce, non la trovo più');
    await page.press('.sn-sidebar-input textarea', 'Enter');
    await expect(file).toHaveCount(3, { timeout: 20_000 });

    // Il modello aveva davanti i due elenchi, ognuno col suo «1.»: il numero da solo non dice di quale ricerca.
    const ultimo = await app.evaluate(() => globalThis.__visti[globalThis.__visti.length - 1]);
    expect(ultimo).toContain(`1. ${BOLLETTA_MARZO}`);
    expect(ultimo).toContain('1. doc_8812.pdf');

    await expect(file.nth(2).locator('.sn-sidebar-file-nome'), 'il bottone è la bolletta della luce che il modello ha detto').toHaveText(BOLLETTA_MARZO);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
