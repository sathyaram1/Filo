// #1562 — la richiesta della chat cresce solo in coda (SPEC-CONTESTO § La richiesta): strumenti e system uguali fra un
// turno e l'altro, la richiesta di un turno è il prefisso di quella dopo, e quello che succede fra due messaggi (un cambio
// dalle Preferenze, un avviso di Filo) arriva davanti al messaggio dopo, con l'id che serve a rimetterlo com'era.

import { test, expect } from './fixtures/electron.mjs';

// Il copione: un giro per voce, con `toolCalls` per gli strumenti ed `errore` per un invio che fallisce.
async function preparaModello(app, copione, extra = {}) {
  await app.evaluate(async (_e, { copione, extra }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      ...extra,
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      // La chat è la richiesta che apre con la parte fissa: il messaggio della home comincia con le stesse parole.
      if (!(!!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic()))) {
        return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify({ messages, tools })));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.errore) throw new Error(r.errore);
      const calls = r.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      try { if (r.text) onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, { copione, extra });
}

async function apriHome(openTab) {
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  return home;
}

async function scrivi(home, testo, risposta) {
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
}

const testo = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''));

test('fra due messaggi: il cambio dalle Preferenze e l\'avviso arrivano davanti al messaggio dopo, e la richiesta di prima resta il suo prefisso', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Ciao!' }, { text: 'Hai messo il tema scuro.' }, { text: 'Va bene.' }]);
  const home = await apriHome(openTab);
  await scrivi(home, 'ciao', 'Ciao!');

  // Fra un messaggio e l'altro l'utente cambia il tema dalle Preferenze, e Filo mostra un avviso nella home.
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#theme')).toHaveValue('light');
  await pref.locator('#theme').selectOption('dark');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme)).toBe('dark');
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.addNotification({ kind: 'alert', text: 'La copia di sicurezza è pronta.' }));
  await pref.close();

  await home.bringToFront();
  await scrivi(home, 'cosa è cambiato?', 'Hai messo il tema scuro.');
  await scrivi(home, 'grazie', 'Va bene.');

  const [uno, due, tre] = await app.evaluate(() => globalThis.__chiamate);
  // Strumenti e parte fissa uguali a ogni chiamata; il CONTESTO dell'utente fermo fra un turno e l'altro.
  expect(JSON.stringify(due.tools)).toBe(JSON.stringify(uno.tools));
  expect(JSON.stringify(tre.tools)).toBe(JSON.stringify(uno.tools));
  expect(due.messages[0].content).toBe(uno.messages[0].content);
  expect(uno.messages[0].content).toContain('═══ CONTESTO (lo scrive Filo');
  // La richiesta di un turno è il prefisso di quella dopo: il turno dopo aggiunge in coda e basta.
  expect(due.messages.slice(0, uno.messages.length)).toEqual(uno.messages);
  expect(tre.messages.slice(0, due.messages.length)).toEqual(due.messages);

  // Davanti al secondo messaggio, scritto da Filo e in busta, quello che è successo nel frattempo.
  const domanda = testo(due.messages[due.messages.length - 1]);
  expect(domanda).toMatch(/^\[\w{3} \d+ \w{3} \d{4}, \d\d:\d\d · chat \w{4}\]\n═══ DA FILO, PRIMA DI QUESTO MESSAGGIO ═══/);
  expect(domanda).toMatch(/<<<FILO_ACCADUTI>>>[\s\S]*cambio dalle Preferenze c[0-9a-f]{10}: tema: chiaro → scuro[\s\S]*<<<FINE_FILO_ACCADUTI>>>/);
  expect(domanda).toMatch(/<<<FILO_ACCADUTI>>>[\s\S]*avviso di Filo: «La copia di sicurezza è pronta\.»[\s\S]*<<<FINE_FILO_ACCADUTI>>>/);
  expect(domanda.endsWith('═══ IL MESSAGGIO DELL\'UTENTE ═══\ncosa è cambiato?')).toBe(true);
  // Lo STATO non porta più i cambi recenti: arrivano dal filo.
  expect(uno.messages[0].content).not.toContain('CAMBI RECENTI');
});

test('una conversazione ripresa dalla Cronologia e quella della home, alternate: la richiesta di un turno resta il prefisso di quella dopo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  // Un tetto in token basso fa sì che la conversazione di stamattina cominci prima del taglio, come succede col tetto di
  // serie a chi ha letto qualche pagina lunga negli ultimi giorni.
  await preparaModello(app, [{ text: 'Risposta uno.' }, { text: 'Risposta due.' }, { text: 'Risposta tre.' }], { contestoFilo: { token: 4000 } });
  const ids = await app.evaluate(async () => {
    const Chats = globalThis.SN_FILO_CHATS;
    const ora = Date.now();
    const fa = (min) => new Date(ora - min * 60000).toISOString();
    const A = 'a1a1a1a1-0000-4000-8000-000000000001';
    const B = 'b2b2b2b2-0000-4000-8000-000000000002';
    for (let i = 0; i < 12; i++) {
      await Chats.append(A, { role: 'user', text: `Parte ${i} della tesi: ${'parole della tesi '.repeat(90)}`, ts: fa(300 - i * 2) });
      await Chats.append(A, { role: 'filo', text: `Letta la parte ${i}.`, ts: fa(299 - i * 2) });
    }
    await Chats.append(B, { role: 'user', text: 'che tempo fa domani?', ts: fa(20) });
    await Chats.append(B, { role: 'filo', text: 'Sole.', ts: fa(19) });
    return { A, B };
  });

  const ripresa = await openTab(`filo://newtab/?chat=${ids.A}`);
  await expect(ripresa.locator('#input')).toBeEditable({ timeout: 15_000 });
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });

  await ripresa.bringToFront();
  await scrivi(ripresa, 'riprendiamo la tesi', 'Risposta uno.');
  await home.bringToFront();
  await scrivi(home, 'e dopodomani?', 'Risposta due.');
  await ripresa.bringToFront();
  await scrivi(ripresa, 'e la conclusione?', 'Risposta tre.');

  const [uno, due, tre] = await app.evaluate(() => globalThis.__chiamate);
  expect(due.messages[0].content).toBe(uno.messages[0].content);
  // Senza la domanda (l'ultimo messaggio), il tratto del turno prima deve stare tale e quale in testa a quello dopo.
  const tratto = (c) => c.messages.slice(1, -1).map(testo);
  expect(tratto(due).slice(0, tratto(uno).length)).toEqual(tratto(uno));
  expect(tratto(tre).slice(0, tratto(due).length)).toEqual(tratto(due));
});

test('una scheda aperta prima di «Continua» arriva al modello nel messaggio dopo, come senza il Continua', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [
    // Un turno che legge e poi tace: sotto compare «Continua».
    { toolCalls: [{ id: 'l1', name: 'LEGGI_IMPOSTAZIONI', arguments: JSON.stringify({ cerca: 'tema' }) }] },
    { text: '' },
    { text: 'Ripreso.' },
    { text: 'Ecco le schede.' },
  ]);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill('che tema ho?');
  await home.locator('#sendBtn').click();
  const continua = home.locator('.dash-continua');
  await expect(continua).toBeVisible({ timeout: 15_000 });

  // Fra il turno e il Continua l'utente apre un sito.
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Orari del museo Egizio</title><p>orari</p>');
  await expect(sito).toHaveTitle('Orari del museo Egizio');
  await home.bringToFront();
  await continua.click();
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ripreso.' })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });

  await scrivi(home, 'quali schede ho aperto?', 'Ecco le schede.');
  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  const ultima = chiamate[chiamate.length - 1];
  // Nel CONTESTO o in un messaggio: da qualche parte il modello deve vedere la scheda aperta.
  const tutto = ultima.messages.map(testo).join('\n');
  expect(tutto).toContain('Orari del museo Egizio');
});

test('una scheda aperta prima di un messaggio finito in errore arriva al modello anche col «Riprova»', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [
    { text: 'Ciao!' },
    { errore: 'servizio non raggiungibile' },
    { text: 'Ecco le schede.' },
  ]);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await scrivi(home, 'ciao', 'Ciao!');

  const sito = await testServer.openReady(openTab, '<!doctype html><title>Orari del museo Egizio</title><p>orari</p>');
  await expect(sito).toHaveTitle('Orari del museo Egizio');
  await home.bringToFront();
  await home.locator('#input').fill('quali schede ho aperto?');
  await home.locator('#sendBtn').click();
  const riprova = home.locator('.dash-action-btn', { hasText: 'Riprova' });
  await expect(riprova).toBeVisible({ timeout: 15_000 });
  await riprova.click();
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ecco le schede.' })).toBeVisible({ timeout: 15_000 });

  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  const tutto = chiamate[chiamate.length - 1].messages.map(testo).join('\n');
  expect(tutto).toContain('Orari del museo Egizio');
});
