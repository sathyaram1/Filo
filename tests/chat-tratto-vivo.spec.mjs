// #1562 — la richiesta della chat cresce solo in coda (SPEC-CONTESTO § La richiesta): strumenti e system uguali fra un
// turno e l'altro, la richiesta di un turno è il prefisso di quella dopo, e quello che succede fra due messaggi (un cambio
// dalle Preferenze, un avviso di Filo) arriva davanti al messaggio dopo, con l'id che serve a rimetterlo com'era.

import { test, expect } from './fixtures/electron.mjs';

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      // La chat è la richiesta che apre con la parte fissa: il messaggio della home comincia con le stesse parole.
      if (!(!!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic()))) {
        return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify({ messages, tools })));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      try { onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, copione);
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
