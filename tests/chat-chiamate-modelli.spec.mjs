// #1097 — costo e velocità delle chiamate ai modelli nella chat della home.
//  (A) una risposta fermata dal tetto di lunghezza si vede interrotta, con «Continua» che la riprende; il tetto arriva
//      al fornitore e Preferenze lo cambia.
//  (B) due ricerche dello stesso giro partono insieme.
//  (C) entrare nel campo della chat sveglia il lettore del computer anche dopo una pausa lunga, e l'attesa prima del
//      modello finisce nella cronologia.
//  (D) il riquadro di una spiegazione fermata dal tetto lo dice, «Continua» chiede il seguito, e la cache non la tiene.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
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

test('A — risposta fermata dal tetto: si vede interrotta, «Continua» la riprende; il tetto arriva al fornitore e si cambia', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreA = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__callsA = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const n = globalThis.__callsA.push({ maxTokens: attempts[0].maxTokens, ultimo: JSON.stringify(messages[messages.length - 1].content) });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [], toolCalls: [] };
      const text = n === 1 ? 'Le tappe del viaggio sono: Roma, Firenze, Bologna e' : ' Venezia. Fine del giro.';
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text, finishReason: n === 1 ? 'length' : 'stop' };
    };
  });

  await page.locator('#input').fill('dimmi le tappe del viaggio');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Firenze' });
  await expect(bolla).toContainText('La risposta si è interrotta qui', { timeout: 15_000 });
  const continua = bolla.locator('.dash-continua');
  await expect(continua).toHaveText('Continua');
  await expect(continua).toHaveAttribute('title', 'Continua la risposta da dove si è interrotta');
  expect((await app.evaluate(() => globalThis.__callsA))[0].maxTokens).toBe(16384);
  await page.screenshot({ path: 'tests/.shots/1097-risposta-interrotta.png' });

  await continua.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Venezia. Fine del giro.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-continua')).toHaveCount(0);
  const seconda = (await app.evaluate(() => globalThis.__callsA))[1];
  expect(seconda.ultimo).toContain('continuare la tua ultima risposta');

  // Preferenze: il segnaposto dice il valore che vale, e un tetto scritto lì arriva alla chiamata dopo.
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#lunghezzaConversazioni')).toHaveAttribute('placeholder', '16384');
  await pref.locator('#lunghezzaConversazioni').fill('4096');
  await pref.locator('#lunghezzaConversazioni').dispatchEvent('change');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).lunghezzaRisposte.conversazioni)).toBe(4096);
  await pref.locator('#sec-lunghezza').screenshot({ path: 'tests/.shots/1097-lunghezza-chiaro.png' });
  await pref.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await pref.locator('#sec-lunghezza').screenshot({ path: 'tests/.shots/1097-lunghezza-scuro.png' });

  await page.bringToFront();
  await shell.locator('.tab').first().click();
  await page.locator('#input').fill('e il ritorno?');
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__callsA.length), { timeout: 15_000 }).toBe(3);
  expect((await app.evaluate(() => globalThis.__callsA))[2].maxTokens).toBe(4096);
  await app.evaluate(() => globalThis.__restoreA());
});

test('B — due ricerche dello stesso giro partono insieme', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    const origWS = globalThis.SN_WEB_SEARCH;
    globalThis.__restoreB = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; globalThis.SN_WEB_SEARCH = origWS; };
    globalThis.__ricerche = [];
    globalThis.SN_WEB_SEARCH = {
      search: async ({ query }) => {
        const r = { query, inizio: Date.now() };
        globalThis.__ricerche.push(r);
        await new Promise((ok) => setTimeout(ok, 1500));
        r.fine = Date.now();
        return { provider: 'finto', results: [{ title: `Risultato ${query}`, url: 'https://example.com/', snippet: 'testo' }] };
      },
    };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [], text: '' };
      if (n === 1) {
        return {
          ...base, finishReason: 'tool_calls',
          toolCalls: [
            { id: 'w1', name: 'CERCA_WEB', arguments: '{"query":"orari treni Milano Roma"}' },
            { id: 'w2', name: 'CERCA_WEB', arguments: '{"query":"meteo Roma domani"}' },
          ],
        };
      }
      try { onDelta && onDelta('Il treno parte alle 9 e a Roma c\'è il sole.'); } catch (_) {}
      return { ...base, text: 'Il treno parte alle 9 e a Roma c\'è il sole.', toolCalls: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('a che ora parte il treno per Roma e che tempo fa?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Il treno parte alle 9' })).toBeVisible({ timeout: 20_000 });
  const ricerche = await app.evaluate(() => globalThis.__ricerche);
  expect(ricerche.map((r) => r.query)).toEqual(['orari treni Milano Roma', 'meteo Roma domani']);
  // La seconda parte prima che la prima finisca.
  expect(ricerche[1].inizio).toBeLessThan(ricerche[0].fine);
  await app.evaluate(() => globalThis.__restoreB());
});

test('C — entrare nel campo della chat dopo una pausa sveglia il lettore del computer; l\'attesa va in cronologia', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    globalThis.__letture = 0;
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => {
      globalThis.__letture += 1;
      return { batteria: { livello: 64, inCarica: false, collegata: false }, rete: { online: true, tipo: 'wifi', nome: 'Casa' }, bluetooth: { acceso: false, dispositivi: [] } };
    });
    globalThis.SN_SISTEMA_MAIN._perProve.veglia(2_000);
    // Nessun tasto né mouse da minuti: nessuna pagina tiene sveglio il lettore.
    globalThis.SN_SISTEMA_MAIN._perProve.inattivita('idle');
  });
  const attivo = () => app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo());
  const giro = await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.GIRO_MS);
  await expect.poll(attivo, { timeout: giro * 2 + 4_000 }).toBe(false);
  await new Promise((r) => setTimeout(r, giro * 2 + 500));

  const prima = await app.evaluate(() => globalThis.__letture);
  await page.evaluate(() => document.getElementById('input').blur());
  await page.locator('#input').focus();
  await expect.poll(() => app.evaluate(() => globalThis.__letture), { timeout: 2_000 }).toBeGreaterThan(prima);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreC = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      try { onDelta && onDelta('Sei al 64%.'); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [], toolCalls: [], text: 'Sei al 64%.', finishReason: 'stop' };
    };
  });
  await page.locator('#input').fill('quanta batteria ho?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei al 64%.' })).toBeVisible({ timeout: 15_000 });
  const voce = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const l = await globalThis.SN_HISTORY.list();
    return l.find((e) => e.action === C.ACTIONS.FILO_CHAT);
  });
  expect(typeof voce.timing.preparazioneMs).toBe('number');
  expect(typeof voce.timing.sistemaMs).toBe('number');
  // Letto da poco all'entrata nel campo: il turno non ha aspettato il computer.
  expect(voce.timing.sistemaMs).toBeLessThan(1_000);

  const storia = await openTab('filo://history/history.html');
  await expect(storia.locator('.sn-history-timing').first()).toHaveText(/^prepara \d+,?\.?\d* s · ragiona/, { timeout: 8_000 });

  await app.evaluate(() => {
    globalThis.__restoreC();
    globalThis.SN_SISTEMA_MAIN._perProve.inattivita();
    globalThis.SN_SISTEMA_MAIN._perProve.veglia(0);
  });
});

test('C2 — senza toccare il campo: muovere il mouse nella home sveglia il lettore', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await page.evaluate(() => document.getElementById('input').blur());
  await app.evaluate(async () => {
    globalThis.__letture = 0;
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => {
      globalThis.__letture += 1;
      return { batteria: { livello: 64, inCarica: false, collegata: false }, rete: { online: true, tipo: 'wifi', nome: 'Casa' }, bluetooth: { acceso: false, dispositivi: [] } };
    });
    globalThis.SN_SISTEMA_MAIN._perProve.veglia(2_000);
    globalThis.SN_SISTEMA_MAIN._perProve.inattivita('idle');
  });
  const attivo = () => app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo());
  const giro = await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.GIRO_MS);
  await expect.poll(attivo, { timeout: giro * 2 + 4_000 }).toBe(false);
  await new Promise((r) => setTimeout(r, giro * 2 + 500));

  // Un suggerimento o «Continua» si raggiungono col mouse: il lettore parte prima del clic.
  const prima = await app.evaluate(() => globalThis.__letture);
  await page.mouse.move(200, 300);
  await page.mouse.move(260, 320);
  await expect.poll(() => app.evaluate(() => globalThis.__letture), { timeout: 2_000 }).toBeGreaterThan(prima);

  await app.evaluate(() => {
    globalThis.SN_SISTEMA_MAIN._perProve.inattivita();
    globalThis.SN_SISTEMA_MAIN._perProve.veglia(0);
  });
});

test('D —riquadro della risposta fermato dal tetto: la riga lo dice, «Continua» chiede il seguito, e non resta in cache', async ({ app }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreD = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__callsD = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const ultimo = String(messages[messages.length - 1].content || '');
      globalThis.__callsD.push({ maxTokens: attempts[0].maxTokens, ultimo });
      const seguito = /Continua da dove ti sei interrotto/.test(ultimo);
      const text = seguito ? 'e per questo si dice così.' : 'La parola viene dal latino';
      onDelta(text);
      return { text, usage: {}, finishReason: seguito ? 'stop' : 'length', model: attempts[0].model, provider: attempts[0].provider };
    };
  });
  // Il riquadro è lo stesso su ogni pagina: qui lo si apre dalla home, dove la sua API è a portata della prova.
  const page = await newtabPage(app);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  const apri = () => page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
    anchor: { x: 120, y: 300 },
    title: 'Approfondisci',
  }));
  await apri();
  const nota = page.locator('.sn-popup .sn-risposta-interrotta');
  await expect(nota).toContainText('La risposta si è interrotta qui', { timeout: 8000 });
  expect((await app.evaluate(() => globalThis.__callsD))[0].maxTokens).toBe(16384);
  await page.locator('.sn-popup').first().screenshot({ path: 'tests/.shots/1097-riquadro-interrotto.png' });
  await nota.locator('button', { hasText: 'Continua' }).click();
  await expect(page.locator('.sn-popup')).toContainText('e per questo si dice così.', { timeout: 8000 });
  await expect(nota.locator('button')).toHaveCount(0);

  // Riaperta, la stessa domanda va di nuovo al modello: una risposta interrotta non si rilegge dalla cache.
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-popup')).toHaveCount(0);
  await apri();
  await expect.poll(() => app.evaluate(() => globalThis.__callsD.length), { timeout: 8000 }).toBe(3);
  await app.evaluate(() => globalThis.__restoreD());
});
