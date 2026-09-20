// #533 — verifica giro 1: la pagina che racconta cosa Filo era autorizzato a
// fare. La sezione promette «le ultime richieste e cosa gli era permesso in
// ciascuna»: queste prove guardano se una richiesta si riconosce davvero.

import { test, expect } from '../../fixtures/electron.mjs';

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

function turno(app, giri, userMessage) {
  return app.evaluate(async (_e, { giri, userMessage }) => {
    const orig = globalThis.SN_PROVIDERS.completeWithFallback;
    let n = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      const giro = giri[n++] || [];
      return {
        text: giro.length ? '' : 'Ecco.',
        toolCalls: giro.map((c, i) => ({ id: `c${n}_${i}`, name: c.name, arguments: JSON.stringify(c.args || {}) })),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    try { await globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [] }); }
    finally { globalThis.SN_PROVIDERS.completeWithFallback = orig; }
  }, { giri, userMessage });
}

async function righe(app, openTab) {
  const page = await openTab('filo://security/');
  await page.waitForSelector('#sec-perimetro-list > div', { timeout: 8000 });
  return { page, testi: await page.$$eval('#sec-perimetro-list > div', (ds) => ds.map((d) => d.textContent)) };
}

test.describe('#533 giro 1 — la pagina Sicurezza', () => {
  test('due richieste diverse si distinguono l\'una dall\'altra', async ({ app, openTab }) => {
    await configura(app);
    await turno(app, [
      [{ name: 'DICHIARA_USCITE', args: { uscite: ['sveglie'] } }],
      [{ name: 'CERCA_WEB', args: { query: 'data esame' } }],
    ], 'Metti la sveglia prima dell\'esame di fisica.');
    await turno(app, [
      [{ name: 'DICHIARA_USCITE', args: { uscite: ['sveglie'] } }],
      [{ name: 'CERCA_WEB', args: { query: 'orario treno' } }],
    ], 'A che ora parte il treno per Bologna?');
    const { testi } = await righe(app, openTab);
    const conLettura = testi.filter((t) => t.includes('scritta da altri'));
    expect(conLettura.length).toBeGreaterThanOrEqual(2);
    // Senza un appiglio alla richiesta, «cosa Filo poteva fare in ciascuna»
    // non è una domanda a cui la pagina risponde.
    const senzaOra = conLettura.map((t) => t.replace(/[\d/:,\sAPM.]+/g, ' ').trim());
    expect(new Set(senzaOra).size, 'due richieste diverse non devono apparire identiche').toBeGreaterThan(1);
  });

  test('la data di una riga è scritta come nel resto di Filo', async ({ app, openTab }) => {
    await configura(app);
    await turno(app, [[{ name: 'SALVA_LEZIONE', args: { testo: 'niente di esterno' } }]], 'ricordati che non bevo caffè');
    const { testi } = await righe(app, openTab);
    const atteso = await app.evaluate(() => new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }).split(',')[0].trim());
    expect(testi.join('\n'), `la data va scritta all'italiana (${atteso})`).toContain(atteso);
  });

  test('la contabilità interna dell\'intervista di benvenuto non è un permesso da mostrare', async ({ app, openTab }) => {
    await configura(app);
    await turno(app, [
      [{ name: 'DICHIARA_USCITE', args: { uscite: ['sveglie'] } }],
      [{ name: 'CERCA_WEB', args: { query: 'x' } }],
    ], 'Metti la sveglia alle 7.');
    const { testi } = await righe(app, openTab);
    expect(testi.join('\n'), 'è contabilità di Filo, non una cosa che l\'utente ha autorizzato')
      .not.toContain('intervista di benvenuto');
  });
});
