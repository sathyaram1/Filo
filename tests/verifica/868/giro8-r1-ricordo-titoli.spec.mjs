// Giro 8 di #868, rilievo 1: tre pezzi ripescati dalla stessa conversazione non ripetono il suo titolo nel blocco.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabs(app) {
  return app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
}
async function primaScheda(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [win] = await newtabs(app);
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const TEMI = ['lisbona', 'ristorante', 'orche', 'fisica', 'esame', 'gatto', 'briciola', 'taberna'];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({
      vectors: texts.map((t) => {
        const s = String(t).toLowerCase();
        const v = TEMI.map((w) => (s.includes(w) ? 1 : 0));
        v.push(0.05);
        return v;
      }),
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.text) { try { onDelta && onDelta(r.text); } catch (_) {} }
      return {
        ...base, text: r.text || '',
        toolCalls: (r.tools || []).map((t, i) => ({ id: `t${globalThis.__chiamate.length}_${i}`, name: t.name, arguments: JSON.stringify(t.args || {}) })),
        reasoningDetails: [], finishReason: r.tools ? 'tool_calls' : 'stop',
      };
    };
  }, copione);
}

async function semina(app, { chat = [] }) {
  await app.evaluate(async (_e, { chat, ora }) => {
    const E = globalThis.SN_FILO_EVENTI;
    const T = E.TIPI;
    const ev = [];
    const ts = (oreFa, piu = 0) => new Date(ora - oreFa * 3600000 + piu).toISOString();
    for (const c of chat) {
      ev.push(E.crea(T.CHAT_APERTA, { chat: c.id }, { ts: ts(c.oreFa), dispositivo: 'prova', autore: 'utente' }));
      c.scambi.forEach(([u, f], i) => {
        ev.push(E.crea(T.MESSAGGIO, { chat: c.id, msg: { role: 'user', text: u } }, { ts: ts(c.oreFa, i * 60000 + 1000), dispositivo: 'prova', autore: 'utente' }));
        ev.push(E.crea(T.MESSAGGIO, { chat: c.id, msg: { role: 'filo', text: f } }, { ts: ts(c.oreFa, i * 60000 + 5000), dispositivo: 'prova', autore: 'filo' }));
      });
      ev.push(E.crea(T.CHAT_CHIUSA, { chat: c.id }, { ts: ts(c.oreFa, 3600000), dispositivo: 'prova', autore: 'utente' }));
      if (c.titolo) ev.push(E.crea(T.CHAT_TITOLO, { chat: c.id, title: c.titolo, kind: 'conversazione' }, { ts: ts(c.oreFa, 3600000), dispositivo: 'prova', autore: 'filo' }));
    }
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, { chat, ora: Date.now() });
}

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('r1 tre pezzi ripescati dalla stessa conversazione: il blocco di attività ne dice il titolo una volta', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await primaScheda(app);
  await semina(app, {
    chat: [{
      id: 'viaggio-lisbona', oreFa: 6 * 24, titolo: 'Viaggio a Lisbona',
      scambi: [
        ['segnati il ristorante di Lisbona: Taberna da Rua', 'Fatto, il ristorante è Taberna da Rua.'],
        ['a Lisbona il ristorante apre alle 19?', 'Sì, il ristorante apre alle 19.'],
        ['quanto costa il ristorante a Lisbona?', 'Il ristorante costa circa 30 euro.'],
      ],
    }],
  });
  await preparaModello(app, [{ text: 'Si chiamava Taberna da Rua.' }]);
  await scrivi(page, 'come si chiamava il ristorante di Lisbona?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Si chiamava Taberna da Rua.' })).toBeVisible({ timeout: 15_000 });
  const blocco = page.locator('.dash-activity');
  await blocco.locator('.dash-activity-head').click();
  const riga = blocco.locator('.dash-activity-row', { hasText: 'Ricordato dal filo' });
  await expect(riga).toContainText('Viaggio a Lisbona');
  const volte = (await riga.innerText()).split('Viaggio a Lisbona').length - 1;
  expect(volte).toBe(1);
});
