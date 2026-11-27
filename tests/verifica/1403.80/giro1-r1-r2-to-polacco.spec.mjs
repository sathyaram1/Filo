// Verifica #1403.80, giro 1: il PIN detto in polacco col «to», scritto in chat, non arriva intero al modello;
// un numero in una frase inglese non diventa riservato perché vicino c'è una parola che somiglia al polacco.

import { test, expect } from '../../fixtures/electron.mjs';

async function chatFinta(app) {
  await app.evaluate(async () => {
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
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const n = globalThis.__chiamate.push(JSON.stringify(messages));
      const text = `RICEVUTO ${n}`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, toolCalls: [], finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
    };
  });
}

async function manda(app, home, frase) {
  const prima = (await app.evaluate(() => globalThis.__chiamate.length));
  await home.locator('#input').fill(frase);
  await home.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__chiamate.length), { timeout: 20_000 }).toBeGreaterThan(prima);
  await expect(home.locator('.dash-bubble-filo', { hasText: `RICEVUTO ${prima + 1}` })).toBeVisible({ timeout: 20_000 });
  return app.evaluate((_e, i) => globalThis.__chiamate[i], prima);
}

test('le frasi della segnalazione arrivano al modello col PIN tolto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const home = await openTab('filo://newtab/');
  await chatFinta(app);
  for (const frase of ['Mój PIN to 4829', 'Mój kod PIN to 4829', 'Mój tajny numer to 4829', 'Mój tajny numer: 4829']) {
    const mandato = await manda(app, home, frase);
    expect(mandato, frase).not.toContain('4829');
    expect(mandato, frase).toContain('[dato riservato]');
  }
});

test('r1 il PIN in polacco col «to» senza «mój» davanti arriva intero al modello', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const home = await openTab('filo://newtab/');
  await chatFinta(app);
  for (const frase of ['Słuchaj, PIN to 4829', 'Jego PIN to 4829', 'Jej PIN to 4829', 'Hej, PIN mojej karty to 4829', 'Pamiętaj: PIN do bankomatu to 4829']) {
    const mandato = await manda(app, home, frase);
    expect(mandato, frase).not.toContain('4829');
  }
});

test('r2 in una frase inglese il numero dopo «PIN to» sparisce se vicino c\'è «numerous» o «Kodak»', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const home = await openTab('filo://newtab/');
  await chatFinta(app);
  for (const frase of ['Numerous users: send the PIN to 4829 recipients', 'Kodak support will mail the PIN to 3500 customers']) {
    const mandato = await manda(app, home, frase);
    expect(mandato, frase).toContain(frase.match(/\d{4}/)[0]);
  }
});
