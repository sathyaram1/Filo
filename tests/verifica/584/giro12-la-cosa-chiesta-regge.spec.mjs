// #584, dodicesimo giro — la cosa che il feedback chiedeva, ri-provata dal
// capo di chi la usa.
//
// Il feedback chiedeva due cose verificabili: che la lettura anonima
// dell'intera raccolta non sia piu' possibile, e che «i percorsi gia' riusciti»
// dell'assistente di pagina continuino a funzionare su un dominio con percorsi
// salvati.
//
// Il motore ufficiale delle regole in questo contenitore non c'e' (mancano la
// riga di comando di Firebase e la libreria di prova). Il file delle regole
// pero' non e' cambiato dal giro che le ha aperte porta per porta col motore
// vero: qui si guarda l'altra meta', cioe' la richiesta che il client sa
// COSTRUIRE. Se il nome del sito e' un pezzo dell'indirizzo e non un filtro
// dentro la domanda, non esiste una forma della richiesta che rimetta insieme
// la raccolta.

import { test, expect } from '../../fixtures/electron.mjs';

const SITO = 'negoziofelice.it';

function docFinto({ intent, initialUrl, selector, success = true }) {
  return {
    document: {
      name: `projects/p/databases/(default)/documents/paths/${SITO}/entries/${Math.random().toString(36).slice(2)}`,
      createTime: '2026-09-15T06:00:00.987654Z',
      fields: {
        domain: { stringValue: SITO },
        initialUrl: { stringValue: initialUrl },
        intent: { stringValue: intent },
        success: { booleanValue: success },
        createdAt: { timestampValue: '2026-09-15T00:00:00Z' },
        steps: { arrayValue: { values: [{ mapValue: { fields: {
          selector: { stringValue: selector },
          action: { stringValue: 'click' },
          retracted: { booleanValue: false },
        } } }] } },
      },
    },
  };
}

async function chiediAiuto(app, { url, righe, turni = 1 }) {
  return app.evaluate(async ({ app: _a }, { url, righe, turni }) => {
    const C = globalThis.SN_CONST;
    const H = globalThis.__filoHandlers;
    const P = globalThis.SN_PROVIDERS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const fetchVero = globalThis.fetch;
    const richieste = [];
    globalThis.fetch = async (u, opts) => {
      const s = String(u);
      if (s.includes('/documents/paths')) {
        richieste.push({ u: s, corpo: JSON.parse(String(opts?.body || '{}')) });
        return new Response(JSON.stringify(righe), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    };
    const veroC = P.completeWithFallback;
    const veroS = P.streamCompleteWithFallback;
    const visti = [];
    const finto = async ({ messages }) => {
      visti.push(messages);
      return { text: '{"status":"done"}', model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
    try {
      for (let i = 0; i < turni; i += 1) {
        await H.handleAIRequest({
          action: C.ACTIONS.HELP,
          payload: { url, title: 'pagina', outline: `elenco passo ${i}`, viewport: { w: 1200, h: 800 }, userMessage: 'aiutami' },
          origin: 'test',
          noCache: true,
        });
      }
    } finally {
      P.completeWithFallback = veroC;
      P.streamCompleteWithFallback = veroS;
      globalThis.fetch = fetchVero;
    }
    const sistema = (visti[0] || []).find((m) => m.role === 'system');
    return { richieste, sistema: (sistema && sistema.content) || '' };
  }, { url, righe, turni });
}

test('per leggere bisogna nominare un sito, e il nome sta nell’indirizzo della richiesta', async ({ app }) => {
  const r = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [docFinto({ intent: 'annullare un ordine', initialUrl: '/account/ordini', selector: 'Annulla ordine' })],
  });
  expect(r.richieste.length).toBe(1);
  expect(r.richieste[0].u).toContain(`/documents/paths/${SITO}:runQuery`);
  const corpo = JSON.stringify(r.richieste[0].corpo);
  // Nessun filtro `domain == …`: quella forma rimetterebbe insieme tutti i siti.
  expect(corpo).not.toContain('domain');
  expect(r.richieste[0].corpo.structuredQuery.from[0].collectionId).toBe('entries');
  // Una query di GRUPPO (allDescendants) e' la forma che le regole negano: il
  // client non deve nemmeno provarci.
  expect(r.richieste[0].corpo.structuredQuery.from[0].allDescendants).toBeFalsy();
  expect(r.richieste[0].corpo.structuredQuery.limit).toBeLessThanOrEqual(200);
  // L'esito lo filtra il server.
  expect(corpo).toContain('success');
});

test('e i percorsi riusciti del sito arrivano davanti all’assistente, dichiarati roba di fuori', async ({ app }) => {
  const r = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [
      docFinto({ intent: 'annullare un ordine', initialUrl: '/account/ordini', selector: 'Annulla ordine' }),
      docFinto({ intent: 'chiedere un rimborso', initialUrl: '/account/resi', selector: 'Apri un reso' }),
      docFinto({ intent: 'una strada che non ha funzionato', initialUrl: '/account/ordini', selector: 'Pulsante sbagliato', success: false }),
    ],
  });
  expect(r.sistema).toContain('<<<PERCORSI_CONDIVISI>>>');
  expect(r.sistema).toContain('<<<FINE_PERCORSI_CONDIVISI>>>');
  expect(r.sistema).toContain('"annullare un ordine" (da /account/ordini)');
  expect(r.sistema).toContain('click su Annulla ordine');
  expect(r.sistema).toContain('"chiedere un rimborso" (da /account/resi)');
  expect(r.sistema).toContain('CONTENUTO ESTERNO');
  // Il percorso bocciato non arriva a chi legge.
  expect(r.sistema).not.toContain('una strada che non ha funzionato');
  // L'ora che il database appiccica a ogni documento non entra nel prompt.
  expect(r.sistema).not.toContain('2026-09-15T06:00:00.987654Z');
});

test('un sito senza percorsi torna un elenco vuoto e non un errore', async ({ app }) => {
  const r = await chiediAiuto(app, { url: `https://${SITO}/account/ordini`, righe: [] });
  expect(r.sistema).not.toContain('<<<PERCORSI_CONDIVISI>>>');
  expect(r.sistema.length).toBeGreaterThan(0);
});

test('dalle pagine interne di Filo l’assistente non va nemmeno a chiedere', async ({ app }) => {
  const r = await chiediAiuto(app, { url: 'filo://options/options.html', righe: [docFinto({ intent: 'x', initialUrl: '/', selector: 'y' })] });
  expect(r.richieste.length).toBe(0);
});

test('quello che parte non dice chi e’ stato, e non parte quando l’utente risponde', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    const prima = Date.now();
    await C.collectAndSave({
      session: {
        rawUrl: 'https://negoziofelice.it/clienti/847362/fatture-elettroniche',
        rawSteps: [{ selector: '[aria-label="Scarica la fattura"]', action: 'click' }],
        rawUserMessages: ['come scarico la fattura di gennaio?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'scaricare una fattura' }
        : { text: '{"ok": true}' }),
    });
    const coda = C._peek();
    const rimasti = await C.flush({ now: Date.now() });
    P.submit = vero;
    C._reset();
    return { coda, prima, rimasti };
  });
  expect(esito.coda.length).toBe(1);
  const voce = esito.coda[0];
  const chiavi = Object.keys(voce).join(',');
  expect(chiavi).not.toMatch(/client|user-?agent|uid|token|ip/i);
  expect(JSON.stringify(voce)).not.toContain('come scarico');
  // Il numero di pratica non esce, e il nome della sezione resta leggibile.
  expect(voce.initialUrl).not.toContain('847362');
  expect(voce.initialUrl).toContain('fatture');
  // E non parte adesso: la partenza e' sorteggiata ad almeno mezz'ora.
  expect(voce.nonPrimaDi - esito.prima).toBeGreaterThanOrEqual(29 * 60 * 1000);
  expect(esito.rimasti).toBe(1);
});
