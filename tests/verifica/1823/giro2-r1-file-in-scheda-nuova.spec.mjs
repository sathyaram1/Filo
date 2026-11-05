// #1823 giro 2, rilievo 1: un file della banca che si apre in una scheda nuova da un altro dominio porta con sé la
// pagina da cui arriva, e col nome automatico acceso non va al modello dei nomi.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ hostInPiu: ['cdn-documenti.test'] });

const SEGRETO = 'Saldo disponibile 12.345,67 euro bonifico a Mario Rossi';
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };

test('r1 un estratto conto servito da un altro dominio e aperto in una scheda nuova dalla banca non va al modello dei nomi', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      globalThis.__mandato.push(JSON.stringify(messages));
      return { text: 'Estratto conto', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
  await app.evaluate(async ({}, da) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings',
    settings: { nomiSensati: { scaricamenti: true }, security: { pagineDelicate: { siti: ['sito-pubblico.test'] } } } }, da), DALLE_PREFERENZE);

  const { createServer } = await import('node:http');
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(SEGRETO), 'Content-Disposition': 'attachment; filename="documento.txt"' });
    res.end(SEGRETO);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://cdn-documenti.test:${srv.address().port}/documento.txt`;
    const page = await testServer.openReady(openTab,
      `<!doctype html><title>La mia banca</title><body style="padding:40px"><a id="dl" target="_blank" href="${url}">Scarica l'estratto conto</a></body>`,
      { pubblico: true });
    await page.locator('#dl').click();
    let rec = null;
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      rec = ((r && r.items) || []).find((it) => it.url === url) || null;
      return rec ? rec.state : null;
    }, { timeout: 20000 }).toBe('completed');
    await new Promise((r) => setTimeout(r, 4000));
    const partiti = await app.evaluate(() => globalThis.__mandato.filter((t) => t.includes('12.345,67')).length);
    expect(partiti, 'il contenuto dell\'estratto conto non parte verso il modello dei nomi').toBe(0);
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    expect((((r && r.items) || []).find((it) => it.id === rec.id) || {}).filename).toBe('documento.txt');
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
