// Verifica #1307.3, giro 1: una scheda aperta letta solo in parte lo dice al modello, per ogni strada che ci porta.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function stubModello(app, piani) {
  await app.evaluate(async (_e, piani) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages))) - 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const piano = piani[Math.min(n, piani.length - 1)];
      if (piano.finale) {
        const text = piano.finale;
        try { onDelta && onDelta(text); } catch (_) {}
        return { ...base, text, toolCalls: [], finishReason: 'stop' };
      }
      const toolCalls = piano.strumenti.map((s, i) => ({ id: `c${n}_${i}`, name: s.nome, arguments: JSON.stringify(s.args || {}) }));
      for (const c of toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      return { ...base, text: '', toolCalls, finishReason: 'tool_calls' };
    };
  }, piani);
}

async function reteVietata(app) {
  await app.evaluate(() => {
    globalThis.__scaricati = [];
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url) => { globalThis.__scaricati.push(url); throw new Error('rete vietata'); };
  });
}

async function apriInSecondoPiano(app, url) {
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.tabs.some((t) => t.view.webContents.getURL() === url && !t.view.webContents.isLoading())), url),
  { timeout: 120_000 }).toBe(true);
}

const esitiDi = (app, giro) => app.evaluate((_e, giro) => (globalThis.__chiamate[giro] || [])
  .filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n'), giro);

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

const finito = (page, testo) => expect(page.locator('.dash-bubble-filo', { hasText: testo })).toBeVisible({ timeout: 120_000 });

test('pagina lunghissima di solo testo (oltre il tetto di caratteri), letta senza forzare niente: il modello sa che è la prima parte', async ({ app, openTab, testServer }) => {
  test.setTimeout(300_000);
  const page = await openTab(NEWTAB);
  const riga = 'Il verbale riporta la seduta del consiglio, con gli interventi e le votazioni di ogni punto. '.repeat(10);
  const righe = Array.from({ length: 4600 }, (_, i) => `<p>${i + 1}. ${riga}</p>`).join('\n');
  const url = testServer.html(`<!doctype html><html><head><title>Verbali</title></head><body><main><h1>Verbali</h1>${righe}
<p>ULTIMA_RIGA: la prossima seduta è il 14 novembre</p></main></body></html>`);
  await apriInSecondoPiano(app, url);
  await reteVietata(app);
  await stubModello(app, [{ strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] }, { finale: 'RISPOSTA UNO' }]);
  await chiedi(page, 'quando è la prossima seduta? è in fondo alla pagina che ho aperto');
  await finito(page, 'RISPOSTA UNO');
  const letto = await esitiDi(app, 1);
  expect(letto).toContain('letta dalla scheda aperta');
  expect(letto).not.toContain('ULTIMA_RIGA');
  expect(letto).toContain('Filo ha solo la prima parte');
});

test('la stessa scheda chiesta per numero, come la vede il modello in TAB APERTE: avviso uguale', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(`<!doctype html><html><head><title>Registro</title></head><body><main><h1>Registro</h1><p>${'<b>x</b> '.repeat(160000)}</p>
<p>ULTIMA_RIGA consegnata il 27 settembre</p></main></body></html>`);
  await apriInSecondoPiano(app, url);
  await reteVietata(app);
  const numero = await app.evaluate(async (_e, url) => {
    const schede = await globalThis.SN_FILO_STATE.listTabs();
    return schede.findIndex((t) => t.url === url) + 1;
  }, url);
  expect(numero).toBeGreaterThan(0);
  await stubModello(app, [{ strumenti: [{ nome: 'LEGGI_PAGINA', args: { scheda: numero } }] }, { finale: 'RISPOSTA DUE' }]);
  await chiedi(page, 'quando è stata consegnata l\'ultima spedizione del registro?');
  await finito(page, 'RISPOSTA DUE');
  const letto = await esitiDi(app, 1);
  expect(letto).toContain('letta dalla scheda aperta');
  expect(letto).toContain('Filo ha solo la prima parte');
});

test('il seguito dentro la parte letta (secondo pezzo) ripete l\'avviso', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await openTab(NEWTAB);
  const righe = Array.from({ length: 4000 }, (_, i) => `<p>Spedizione ${i + 1} partita da Bologna e consegnata a Verona.</p>`).join('');
  const url = testServer.html(`<!doctype html><html><head><title>Spedizioni</title></head><body><main><h1>Spedizioni</h1>${righe}
<p>ULTIMA_RIGA consegnata il 27 settembre</p></main></body></html>`);
  await apriInSecondoPiano(app, url);
  await reteVietata(app);
  await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._tempi.scheda = -1; });
  const primo = (await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url }), url)).output;
  expect(primo.lettaInParte).toBe(true);
  await stubModello(app, [{ strumenti: [{ nome: 'LEGGI_PAGINA', args: { url, da: primo.fino } }] }, { finale: 'RISPOSTA TRE' }]);
  await chiedi(page, 'continua a leggere la pagina che ho aperto');
  await finito(page, 'RISPOSTA TRE');
  const letto = await esitiDi(app, 1);
  expect(letto).toContain('Filo ha solo la prima parte');
});

test('una scheda letta in parte la cui prima parte non ha testo: il modello non sente «la pagina non ha testo»', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(`<!doctype html><html><head><title>Tabellone</title></head><body><main>${'<i></i>'.repeat(160000)}
<p>ULTIMA_RIGA consegnata il 27 settembre</p></main></body></html>`);
  await apriInSecondoPiano(app, url);
  await reteVietata(app);
  await stubModello(app, [{ strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] }, { finale: 'RISPOSTA QUATTRO' }]);
  await chiedi(page, 'quando è stata consegnata l\'ultima spedizione nella pagina che ho aperto?');
  await finito(page, 'RISPOSTA QUATTRO');
  const letto = await esitiDi(app, 1);
  console.log('ESITO4', letto);
  expect(letto).not.toContain('non mostra testo da leggere');
  expect(letto).toMatch(/prima parte|solo in parte/);
});
