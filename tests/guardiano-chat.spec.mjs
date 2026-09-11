// #536 — la chat di un compito CONTAMINATO passa dal guardiano.
//
// Il guardiano non vale solo per le notifiche: vale per qualsiasi testo che
// Filo mostra dopo aver letto roba di altri. Oggi il caso vivo è la chat della
// home quando il turno ha usato CERCA_WEB (o ha letto un documento): i
// risultati sono scritti da estranei, e la risposta che ne nasce può portarsi
// dietro le loro istruzioni.
//
// Due prove, dal punto di vista dell'utente:
//   (A) turno contaminato la cui risposta imita la banca → nella chat NON
//       compare quel testo: compare la riga che dice cosa il guardiano ha
//       visto, e il caso entra nel registro dei blocchi;
//   (B) turno PULITO (nessuna lettura da fuori) → il guardiano non viene
//       nemmeno chiamato: un secondo modello su «che ore sono» è spreco.

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

async function configuraModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.GUARDIAN_CHECK]: 'gemma-lite',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Il modello della chat: al primo giro chiama CERCA_WEB (se `cerca`), al
// secondo risponde col testo dato. La ricerca è finta ma ESEGUITA davvero:
// è quello che contamina il turno.
async function finteRisposte(app, { cerca, risposta }) {
  await app.evaluate(async (cfg) => {
    globalThis.SN_WEB_SEARCH.search = async ({ query }) => ({
      provider: 'finto',
      results: [{ title: 'Avviso urgente', url: 'https://banca-x.verifica.test/login', snippet: 'conferma le tue credenziali' }],
      query,
    });
    globalThis.__guardiaChiamate = 0;
    globalThis.SN_GUARDIA_COMPLETE = async ({ messages }) => {
      globalThis.__guardiaChiamate++;
      const testo = String(messages[messages.length - 1].content || '');
      if (/credenzial/i.test(testo)) {
        return '{"esito":"blocca","motivo":"sembrava spingerti a confermare le credenziali su un sito che non è la tua banca"}';
      }
      return '{"esito":"passa"}';
    };
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      giro++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (cfg.cerca && giro === 1) {
        return { ...base, text: 'Cerco…', toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'la mia banca' }) }] };
      }
      return { ...base, text: cfg.risposta, toolCalls: [] };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
  }, { cerca, risposta });
}

test('A — la risposta di un turno contaminato passa dal guardiano: la riga al posto del testo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configuraModelli(app);
  await finteRisposte(app, {
    cerca: true,
    risposta: 'La tua banca chiede di confermare le credenziali: apri https://banca-x.verifica.test/login',
  });

  const r = await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({
    userMessage: 'guarda cosa dice la mia banca', threadHistory: [],
  }));

  // Quello che l'utente legge NON è il testo nato dalla pagina.
  expect(r.text).not.toContain('banca-x.verifica.test');
  expect(r.text).toContain('Ho fermato un avviso');
  expect(r.text).toContain('sembrava spingerti a confermare le credenziali');
  expect(r.guardia.esito).toBe('blocca');

  // Il guardiano è stato chiamato, e il caso è nel registro.
  const chiamate = await app.evaluate(() => globalThis.__guardiaChiamate);
  expect(chiamate).toBe(1);
  const blocchi = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listGuardBlocks());
  expect(blocchi.length).toBe(1);
  expect(blocchi[0].fonte.tipo).toBe('ricerca');
});

test('B — turno pulito: nessun secondo modello, nessun costo, la risposta è quella', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configuraModelli(app);
  await finteRisposte(app, { cerca: false, risposta: 'Sono le 15:20.' });

  const r = await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({
    userMessage: 'che ore sono', threadHistory: [],
  }));
  expect(r.text).toBe('Sono le 15:20.');
  expect(r.guardia).toBeUndefined();
  const chiamate = await app.evaluate(() => globalThis.__guardiaChiamate);
  expect(chiamate).toBe(0);
});
