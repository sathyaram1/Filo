// #584, settimo giro — la cosa che il feedback chiedeva, guardata dal capo di
// chi la usa: l'assistente di pagina si ritrova davanti i percorsi già
// riusciti di un sito nominato, e li chiede a quel sito soltanto.
//
// Il feedback voleva due cose insieme: che la raccolta intera non si scarichi
// più (le regole, provate col motore vero nei giri passati) e che «i percorsi
// già riusciti» continuino a funzionare. Questa prova guarda la seconda con la
// rete dirottata sul cammino vero di Filo: la richiesta che parte, e il
// messaggio di sistema che ne esce davvero dal processo principale.

import { test, expect } from '../../fixtures/electron.mjs';

const SITO = 'negoziofelice.it';

function docFinto(intent, initialUrl, selector, success) {
  return {
    document: {
      name: `projects/p/databases/(default)/documents/paths/${SITO}/entries/${Math.random().toString(36).slice(2)}`,
      createTime: '2026-09-14T00:00:00Z',
      fields: {
        domain: { stringValue: SITO },
        initialUrl: { stringValue: initialUrl },
        intent: { stringValue: intent },
        success: { booleanValue: success },
        steps: { arrayValue: { values: [{ mapValue: { fields: {
          selector: { stringValue: selector },
          action: { stringValue: 'click' },
          retracted: { booleanValue: false },
        } } }] } },
      },
    },
  };
}

// Chiede l'Aiuto per una pagina e restituisce il messaggio di sistema vero, con
// la rete dei percorsi dirottata su `righe`.
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
        payload: { url, title: 'pagina', outline: '', viewport: { w: 1200, h: 800 }, userMessage: 'aiutami' },
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

test('l’assistente chiede i percorsi di UN sito e se li ritrova nel proprio messaggio di sistema', async ({ app }) => {
  const esito = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [
      docFinto('vedere gli ordini passati', '/account/ordini', '[aria-label="I miei ordini"]', true),
      docFinto('annullare un abbonamento', '/account/abbonamenti', '[aria-label="Annulla"]', true),
      docFinto('percorso bocciato', '/account/x', '[aria-label="Non va"]', false),
    ],
  });

  // La richiesta parte SOTTO il sito nominato, con un tetto, e non c'è nessun
  // modo di chiedere «tutti i siti»: il dominio è un pezzo dell'indirizzo.
  expect(esito.richieste.length).toBeGreaterThan(0);
  const prima = esito.richieste[0];
  expect(prima.u).toContain(`/documents/paths/${SITO}:runQuery`);
  expect(prima.corpo.structuredQuery.from).toEqual([{ collectionId: 'entries' }]);
  expect(prima.corpo.structuredQuery.limit).toBeLessThanOrEqual(200);
  // l'esito lo filtra il server
  expect(JSON.stringify(prima.corpo)).toContain('success');

  // I percorsi si ritrovano nel messaggio di sistema dell'assistente, dentro le
  // due marcature che li dichiarano roba venuta da fuori.
  expect(esito.sistema).toContain('<<<PERCORSI_CONDIVISI>>>');
  expect(esito.sistema).toContain('<<<FINE_PERCORSI_CONDIVISI>>>');
  expect(esito.sistema).toContain('vedere gli ordini passati');
  expect(esito.sistema).toContain('annullare un abbonamento');
  expect(esito.sistema).toContain('/account/ordini');
  // Il pollice in giù non arriva a chi legge.
  expect(esito.sistema).not.toContain('percorso bocciato');
});

test('un sito senza percorsi non apre nemmeno il blocco, e non è un errore', async ({ app }) => {
  const esito = await chiediAiuto(app, { url: `https://${SITO}/`, righe: [{}] });
  expect(esito.sistema.length).toBeGreaterThan(0);
  expect(esito.sistema).not.toContain('<<<PERCORSI_CONDIVISI>>>');
});

test('sulle pagine interne di Filo l’assistente non va nemmeno a chiedere', async ({ app }) => {
  const esito = await chiediAiuto(app, { url: 'filo://options/options.html', righe: [] });
  expect(esito.richieste, 'niente rete per una cartella che è la stessa per tutti').toEqual([]);
  expect(esito.sistema).not.toContain('<<<PERCORSI_CONDIVISI>>>');
});

test('chiedere più del tetto non si fa rifiutare: il client si ferma prima da sé', async ({ app }) => {
  const limiti = await app.evaluate(async () => {
    const P = globalThis.SN_PATHS;
    const fetchVero = globalThis.fetch;
    const visti = [];
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('/documents/paths')) {
        visti.push(JSON.parse(String(opts?.body || '{}')).structuredQuery.limit);
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    };
    try {
      for (const n of [5000, 201, 0, -3, NaN, 'tanti']) await P.listByDomain('esempio.it', { pageSize: n });
      return visti;
    } finally { globalThis.fetch = fetchVero; }
  });
  expect(limiti.length).toBeGreaterThan(0);
  for (const l of limiti) {
    expect(l).toBeGreaterThanOrEqual(1);
    expect(l).toBeLessThanOrEqual(200);
  }
});

test('un nome di sito scritto male non tocca nemmeno la rete', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const P = globalThis.SN_PATHS;
    const fetchVero = globalThis.fetch;
    let toccate = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/documents/paths')) toccate += 1;
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const storti = ['', '   ', '/', 'a/b', '..', '.', '__x__', 'https://sito.it/pagina',
      'a'.repeat(400), '<script>alert(1)</script>', 'sito .it', 'sito\nit', 'sito:8080', '😀.it'];
    const risultati = {};
    try {
      for (const d of storti) risultati[JSON.stringify(d)] = (await P.listByDomain(d)).length;
      return { risultati, toccate };
    } finally { globalThis.fetch = fetchVero; }
  });
  for (const [nome, quanti] of Object.entries(esito.risultati)) {
    expect(quanti, `${nome} non deve rendere niente`).toBe(0);
  }
  expect(esito.toccate, 'nessuna richiesta di rete per un nome storto').toBe(0);
});
