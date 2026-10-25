// Verifica #1589 giro 16. r1: un codice che apre qualcosa (cancello, cassaforte, prelievo) arriva al modello, mentre
// un identificativo con l'etichetta in maiuscolo o in inglese sparisce. r2: un numero sulla riga sotto un codice sparisce.
import { test, expect } from '../../fixtures/electron.mjs';

async function leggiInChat({ app, openTab, testServer }, titolo, corpo, domanda) {
  const h = await openTab('filo://newtab/');
  const url = testServer.html(`<!doctype html><html><head><title>${titolo}</title></head><body><main>${corpo}</main></body></html>`, { pubblico: true });
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  await app.evaluate(async (_e, titolo) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate.push(JSON.stringify(messages)) - 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (n === 0) {
        const esc = titolo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = new RegExp(`(\\d+)\\. (?:\\[FOCUS\\] )?${esc}`).exec(messages.map((x) => String(x.content || '')).join('\n'));
        const call = { id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ scheda: m ? Number(m[1]) : 0 }) };
        try { onToolCall && onToolCall({ id: call.id, name: call.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [call], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('LETTA'); } catch (_) {}
      return { ...base, text: 'LETTA', toolCalls: [], finishReason: 'stop' };
    };
  }, titolo);
  await h.bringToFront();
  await h.locator('#input').fill(domanda);
  await h.locator('#sendBtn').click();
  await expect(h.locator('.dash-bubble-filo', { hasText: 'LETTA' })).toBeVisible({ timeout: 20_000 });
  return (await app.evaluate(() => globalThis.__chiamate)).join('\n');
}

test('r1 il codice del cancello, della cassaforte e del prelievo senza carta non arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Istruzioni per il check-in', `<h1>Istruzioni per il check-in</h1>
    <p>Il codice del cancello è 4829.</p>
    <p>Il codice della cassetta delle chiavi è 7316.</p>
    <p>Il codice della cassaforte è 5502.</p>
    <p>Il tuo codice di prelievo è 918273.</p>
    <p>Codice di ritiro 640385</p>`, 'dalla pagina Istruzioni per il check-in: come entro?');
  expect(mandato, 'la pagina è stata letta').toContain('Istruzioni per il check-in');
  for (const s of ['4829', '7316', '5502', '918273', '640385']) expect(mandato, s).not.toContain(s);
});

test('r1 un identificativo con l\'etichetta in maiuscolo o in inglese arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Il mio abbonamento', `<h1>Il mio abbonamento</h1>
    <p>Codice Abbonamento: 48291375</p>
    <p>Codice Utente: 551902</p>
    <p>Membership code: 73920461</p>
    <p>Event code: 739204</p>`, 'dalla pagina Il mio abbonamento: qual è il mio codice abbonamento?');
  expect(mandato, 'la pagina è stata letta').toContain('Il mio abbonamento');
  for (const s of ['48291375', '551902', '73920461', '739204']) expect(mandato, s).toContain(s);
});

test('r2 il numero della riga sotto un codice arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Il corso', `<h1>Il corso</h1>
    <table><tr><td>Codice evento</td><td>739204</td></tr><tr><td>Posti disponibili</td><td>1200</td></tr></table>`,
  'dalla pagina Il corso: quanti posti ci sono?');
  expect(mandato, 'la pagina è stata letta').toContain('Il corso');
  expect(mandato).toContain('1200');
});
