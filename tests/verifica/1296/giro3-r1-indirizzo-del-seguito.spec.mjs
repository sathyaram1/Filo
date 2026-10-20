// Verifica #1296, riallineamento, rilievo 1: l'indirizzo scritto dall'utente in un seguito è parola sua anche per la
// regola dell'indirizzo scritto arrivata da main (#553): dopo una ricerca la pagina che ha indicato si legge senza rifiuto.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const PAGINA = 'https://orari.example/treni/milano-roma-del-mattino.html';

test('r1 dopo una ricerca, la pagina indicata in un seguito si legge subito, senza tornare al modello come scritta da lui', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await app.evaluate(async (_e, pagina) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    globalThis.__scaricati = [];
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url) => {
      globalThis.__scaricati.push(url);
      return new Response('<!doctype html><html><body><main><h1>Orari</h1><p>Primo treno del mattino: ORARIO_745 da Milano Centrale.</p></main></body></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
    // La ricerca è lenta: il seguito parte mentre Filo aspetta i risultati.
    globalThis.SN_WEB_SEARCH.search = async () => {
      await new Promise((r) => setTimeout(r, 2500));
      return { ok: true, provider: 'stub', results: [{ title: 'Treni Milano Roma', url: 'https://notizie.example/treni', snippet: 'Orari dei treni.' }] };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages))) - 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const tutto = messages.filter((m) => m.role !== 'system').map((m) => String(m.content || '')).join('\n');
      const giro = (nome, args) => {
        const c = { id: `c${n}`, name: nome, arguments: JSON.stringify(args) };
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [c], finishReason: 'tool_calls' };
      };
      if (n === 0) return giro('CERCA_WEB', { query: 'treni milano roma' });
      if (n === 1 && tutto.includes(pagina)) return giro('LEGGI_PAGINA', { url: pagina });
      const m = /(ORARIO_\d+)/.exec(tutto);
      const text = `RISPOSTA: ${m ? m[1] : 'NON_TROVATO'}`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
  }, PAGINA);

  await page.locator('#input').fill('cerca gli orari dei treni da Milano a Roma');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(800);
  await page.locator('#input').fill(`leggi questa pagina: ${PAGINA}`);
  await page.locator('#input').press('Enter');

  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA:' })).toBeVisible({ timeout: 20_000 });
  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  expect(chiamate[1].map((x) => String(x.content || '')).join('\n'), 'il seguito arriva alla seconda chiamata').toContain(PAGINA);
  const esiti = (chiamate[2] || []).filter((x) => x.role === 'tool').map((x) => String(x.content || '')).join('\n');
  expect(esiti, 'l\'indirizzo l\'ha scritto l\'utente').not.toContain('non compare da nessuna parte');
  expect(await app.evaluate(() => globalThis.__scaricati)).toEqual([PAGINA]);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA: ORARIO_745' })).toBeVisible();
});
