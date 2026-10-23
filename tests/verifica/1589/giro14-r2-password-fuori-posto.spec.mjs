// Verifica #1589 giro 14, rilievo 2: una password scritta accanto all'utente («Utente / Password: mario / …»), nella
// risposta di una chat o dopo il nome della rete arriva al modello: le regole la cercano solo al posto del valore.
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

test('r2 credenziali in coppia, risposta in una chat e rete col trattino: le password non arrivano al modello', async ({ app, openTab, testServer }) => {
  const fx = { app, openTab, testServer };
  test.setTimeout(90_000);
  const mandato = await leggiInChat(fx, 'Messaggi con Luca', `<h1>Messaggi con Luca</h1>
    <p>Benvenuto nel gestionale. Indirizzo: gestionale.example.com</p>
    <p>Username / Password: mario / Girasole2024</p>
    <div>Qual è la password del wifi?</div><div>Brezza7Mare</div>
    <p>Wi-Fi: CasaRossi - Faro7Blu55</p>
    <p>Ecco i dati: utente mario.rossi, pw Ponte9Grigio</p>`, 'dalla pagina Messaggi con Luca: riassumi');
  expect(mandato, 'la pagina è stata letta').toContain('gestionale.example.com');
  for (const s of ['Girasole2024', 'Brezza7Mare', 'Faro7Blu55', 'Ponte9Grigio']) expect(mandato, s).not.toContain(s);
});
