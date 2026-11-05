// Esplorazione: un file della banca servito da un altro dominio, aperto in una scheda nuova.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ hostInPiu: ['cdn-documenti.test'] });

const SEGRETO = 'Saldo disponibile 12.345,67 euro bonifico a Mario Rossi';
async function modelliFinti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      globalThis.__mandato.push({ testo: JSON.stringify(messages) });
      return { text: 'Estratto conto', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
}
const mandato = (app) => app.evaluate(() => globalThis.__mandato.slice());
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
const impostaDaFilo = (app, settings) => app.evaluate(async ({}, { s, da }) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: s }, da), { s: settings, da: DALLE_PREFERENZE });

for (const [delicato, bersaglio] of [[true, "_blank"], [true, "_self"], [false, "_blank"]]) {
  test(`file da un altro dominio in scheda nuova, banca delicata=${delicato} ${bersaglio}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(90_000);
    await modelliFinti(app);
    await impostaDaFilo(app, { nomiSensati: { scaricamenti: true }, security: { pagineDelicate: { siti: delicato ? ['sito-pubblico.test'] : [] } } });
    const { createServer } = await import('node:http');
    const corpo = delicato ? SEGRETO : 'Verbale della riunione';
    const srv = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(corpo), 'Content-Disposition': 'attachment; filename="documento.txt"' });
      res.end(corpo);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://cdn-documenti.test:${srv.address().port}/documento.txt`;
    const page = await testServer.openReady(openTab, `<!doctype html><title>Banca</title><body style="padding:40px"><a id="dl" target="${bersaglio}" href="${url}">Estratto conto</a></body>`, { pubblico: true });
    await page.locator('#dl').click();
    let rec = null;
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      rec = ((r && r.items) || []).find((it) => it.url === url) || null;
      return rec ? rec.state : null;
    }, { timeout: 20000 }).toBe('completed');
    const interno = await app.evaluate(({}, id) => {
      return null;
    }, rec.id);
    await new Promise((r) => setTimeout(r, 4000));
    const m = (await mandato(app)).filter((x) => x.testo.includes('Verbale') || x.testo.includes('12.345'));
    console.log('delicato', delicato, 'chiamate al modello dei nomi', m.length, interno);
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
    if (delicato) expect(m).toEqual([]);
    else expect(m.length).toBe(1);
  });
}
