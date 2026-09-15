// #584, tredicesimo giro — la cosa che il feedback chiedeva, ri-provata dopo
// che il ramo e' stato ribasato su main.
//
// Questo giro nasce da un ribasamento: il lavoro e' stato rimesso sopra un main
// che nel frattempo si era mosso, risolvendo dei conflitti. Un conflitto
// risolto male non si vede nel diff e non lo prende nessuna prova di prima:
// quello che si guarda qui e' che le due cose CHIESTE dal feedback siano ancora
// vere sul ramo che si sta per fondere.
//
//   1. «lettura anonima dell'intera collezione rifiutata» — dal lato che il
//      client puo' provare: il nome del sito sta nell'INDIRIZZO della richiesta
//      e non e' un filtro dentro la domanda, quindi non esiste una forma della
//      richiesta che rimetta insieme la raccolta.
//   2. «la funzione "percorsi gia' riusciti" dell'agente di pagina ancora
//      funzionante su un dominio con percorsi salvati».
//
// Il motore ufficiale delle regole in questo contenitore non c'e' (mancano la
// riga di comando di Firebase e la libreria di prova). L'altra meta' — le
// regole aperte porta per porta col motore vero — sta nei giri che l'avevano.

import { test, expect } from '../../fixtures/electron.mjs';

const SITO = 'negoziofelice.it';

function docFinto({ intent, initialUrl, selector, success = true }) {
  return {
    document: {
      name: `projects/p/databases/(default)/documents/paths/${SITO}/entries/${Math.random().toString(36).slice(2)}`,
      createTime: '2026-09-15T09:30:00.123456Z',
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

async function chiediAiuto(app, { url, righe }) {
  return app.evaluate(async ({ app: _a }, { url, righe }) => {
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
      await H.handleAIRequest({
        action: C.ACTIONS.HELP,
        payload: { url, title: 'pagina', outline: 'elenco', viewport: { w: 1200, h: 800 }, userMessage: 'aiutami' },
        origin: 'test',
        noCache: true,
      });
    } finally {
      P.completeWithFallback = veroC;
      P.streamCompleteWithFallback = veroS;
      globalThis.fetch = fetchVero;
    }
    const sistema = (visti[0] || []).find((m) => m.role === 'system');
    return { richieste, sistema: (sistema && sistema.content) || '' };
  }, { url, righe });
}

test('per leggere bisogna nominare un sito: il nome sta nell’indirizzo, non in un filtro', async ({ app }) => {
  const r = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [docFinto({ intent: 'annullare un ordine', initialUrl: '/account/ordini', selector: 'Annulla ordine' })],
  });
  expect(r.richieste.length).toBe(1);
  const { u, corpo } = r.richieste[0];
  // Il sito e' un SEGMENTO dell'indirizzo, sotto `paths`.
  expect(u).toContain(`/documents/paths/${SITO}:runQuery`);
  // E nel corpo non c'e' nessun filtro sul dominio: se ci fosse, chi chiede
  // potrebbe anche non metterlo e riavere la raccolta intera.
  const testo = JSON.stringify(corpo);
  expect(testo).not.toContain('domain');
  expect(corpo.structuredQuery.from).toEqual([{ collectionId: 'entries' }]);
  // Il tetto lo mette il client da se', e sta dentro quello che le regole
  // accettano.
  expect(corpo.structuredQuery.limit).toBeGreaterThan(0);
  expect(corpo.structuredQuery.limit).toBeLessThanOrEqual(200);
});

test('i percorsi riusciti del sito arrivano davanti all’assistente, dichiarati roba di fuori', async ({ app }) => {
  const r = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [
      docFinto({ intent: 'annullare un ordine', initialUrl: '/account/ordini', selector: 'Annulla ordine' }),
      docFinto({ intent: 'un percorso bocciato', initialUrl: '/x', selector: 'Boh', success: false }),
    ],
  });
  expect(r.sistema).toContain('<<<PERCORSI_CONDIVISI>>>');
  expect(r.sistema).toContain('<<<FINE_PERCORSI_CONDIVISI>>>');
  expect(r.sistema).toContain('annullare un ordine');
  expect(r.sistema).toContain('Annulla ordine');
  // Il pollice in giu' non arriva a chi legge.
  expect(r.sistema).not.toContain('un percorso bocciato');
  // E l'ora che il database appiccica a ogni documento non entra nel prompt:
  // era la chiave con cui si ricucivano i percorsi della stessa persona.
  expect(r.sistema).not.toContain('09:30:00');
  expect(r.sistema).not.toContain('2026-09-15');
});

test('un sito senza percorsi torna un elenco vuoto e non un errore', async ({ app }) => {
  const r = await chiediAiuto(app, { url: `https://${SITO}/vuoto`, righe: [] });
  expect(r.richieste.length).toBe(1);
  expect(r.sistema).not.toContain('<<<PERCORSI_CONDIVISI>>>');
  expect(r.sistema.length).toBeGreaterThan(0);
});

test('dalle pagine interne di Filo e dai siti che non sono di nessuno non si va nemmeno a chiedere', async ({ app }) => {
  for (const url of ['filo://options/options.html', 'http://localhost:3000/admin', 'http://app.localhost/x', 'http://progetto-rossi.test/clienti', 'http://192.168.1.1/setup']) {
    const r = await chiediAiuto(app, { url, righe: [docFinto({ intent: 'x', initialUrl: '/x', selector: 'y' })] });
    expect(r.richieste, `da ${url} non si chiede niente`).toEqual([]);
  }
});

test('quello che parte non dice chi è stato, e non parte quando l’utente risponde', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const PC = globalThis.SN_PATHS_COLLECTOR;
    PC._reset();
    PC._setAuto(false);
    const chiamate = [];
    const invokeAI = async ({ action, payload }) => {
      chiamate.push({ action, payload });
      const C = globalThis.SN_CONST;
      if (action === C.ACTIONS.HELP_INTENT_GUESS) return { text: 'annullare un ordine' };
      return { text: '{"ok": true}' };
    };
    const r = await PC.collectAndSave({
      session: {
        rawUrl: 'https://negoziofelice.it/u/mario.rossi/ordini/847362?token=segreto#x',
        rawSteps: [{ selector: 'Ordine di mario.rossi@x.it', action: 'click' }],
        rawUserMessages: ['come annullo un ordine?'],
        success: true,
      },
      invokeAI,
    });
    const coda = PC._peek();
    PC._reset();
    return { r, coda, chiamate };
  });
  expect(esito.r.saved).toBe(true);
  expect(esito.coda.length).toBe(1);
  const voce = esito.coda[0];
  // Nel documento non c'è niente del mittente…
  const campi = JSON.stringify(voce);
  expect(campi).not.toContain('clientId');
  expect(campi).not.toContain('userAgent');
  // …l'indirizzo è ripulito (nome utente e numero di conto), la query resta a casa…
  expect(voce.initialUrl).toBe('/u/[ID]/ordini/[NUMERO]');
  expect(campi).not.toContain('segreto');
  expect(voce.steps[0].selector).toBe('Ordine di [EMAIL]');
  // …e non parte adesso: aspetta in coda almeno mezz'ora.
  expect(voce.nonPrimaDi - voce.accodatoIl).toBeGreaterThanOrEqual(30 * 60 * 1000);
  // Il giudice ha visto davvero quello che sarebbe uscito, non «(nessuna)».
  const giudice = esito.chiamate.find((c) => c.action === 'help_intent_judge');
  expect(giudice).toBeTruthy();
  expect(giudice.payload.domain).toBe('negoziofelice.it');
  expect(giudice.payload.initialUrl).toBe('/u/[ID]/ordini/[NUMERO]');
  expect(giudice.payload.steps[0].selector).toBe('Ordine di [EMAIL]');
});
