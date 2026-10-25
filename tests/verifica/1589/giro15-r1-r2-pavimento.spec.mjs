// Verifica #1589 giro 15. r1: i numeri di un «codice di qualcosa» che non apre niente (abbonamento, evento, corso)
// spariscono al modello. r2: il corpo di una chiave privata PGP o PuTTY arriva al modello.
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

test('r1 i codici che non aprono niente (abbonamento, utente, evento, corso) arrivano al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'La mia iscrizione', `<h1>La mia iscrizione</h1>
    <p>Codice abbonamento 48291375</p>
    <p>Il tuo codice utente è 551902</p>
    <p>Codice evento 739204</p>
    <p>Il codice del corso è 4829</p>`, 'dalla pagina La mia iscrizione: qual è il mio codice abbonamento?');
  expect(mandato, 'la pagina è stata letta').toContain('La mia iscrizione');
  for (const s of ['48291375', '551902', '739204', 'corso è 4829']) expect(mandato, s).toContain(s);
});

test('r2 il corpo di una chiave privata PGP o PuTTY non arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Le mie chiavi', `<h1>Le mie chiavi</h1>
    <pre>-----BEGIN PGP PRIVATE KEY BLOCK-----

lQOYBF3jN2kBCAC5q8xR2vT7mN4pK9wL3sA1dF6gH8jZ0cX2vB5nM7qW4eR9tY1u
=Ab3x
-----END PGP PRIVATE KEY BLOCK-----</pre>
    <pre>PuTTY-User-Key-File-3: ssh-ed25519
Encryption: none
Comment: mario@pc
Public-Lines: 1
AAAAC3NzaC1lZDI1NTE5AAAAIOgJ8X2vB5nM7qW4eR9tY1uLqW3eR5cN4wAAAAJgK9Xh
Private-Lines: 1
AAAAIFq8xR2vT7mN4pK9wL3sA1dF6gH8jZ0cX2vB5nM7qW4eR9tY1uLqW3eR5
Private-MAC: 8f14e45fceea167a5a36dedd4bea25438f14e45fceea167a</pre>`, 'dalla pagina Le mie chiavi: che tipo di chiavi sono?');
  expect(mandato, 'la pagina è stata letta').toContain('Le mie chiavi');
  for (const s of ['lQOYBF3jN2kBCAC5q8xR2vT7mN4pK9wL3sA1dF6gH8jZ0cX2vB5nM7qW4eR9tY1u', 'AAAAIFq8xR2vT7mN4pK9wL3sA1dF6gH8jZ0cX2vB5nM7qW4eR9tY1uLqW3eR5']) {
    expect(mandato, s).not.toContain(s);
  }
});
