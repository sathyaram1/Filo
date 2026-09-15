// #584, decimo giro — la cosa che il feedback chiedeva, ri-provata dal capo di
// chi la usa.
//
// Il feedback chiedeva due cose verificabili: che la lettura anonima
// dell'intera raccolta non sia più possibile, e che «i percorsi già riusciti»
// dell'assistente di pagina continuino a funzionare su un sito che ne ha.
//
// Il motore vero delle regole in questo contenitore non c'è (manca la riga di
// comando di Firebase e manca la libreria di prova), quindi la prima metà si
// guarda da dove la si può guardare senza: la richiesta che il client sa
// COSTRUIRE. Se il nome del sito è un pezzo dell'indirizzo e non un filtro,
// non esiste una forma della domanda che rimetta insieme la raccolta.
//
// La seconda metà si guarda con la rete dirottata sul cammino vero: il
// messaggio di sistema che esce davvero dal processo principale.
//
// E una terza, che il nono giro ha appena cambiato: chi LEGGE e chi SCRIVE
// decidono il nome del sito con la stessa regola. Divergevano, e una richiesta
// partiva verso una cartella destinata a restare vuota per sempre.

import { test, expect } from '../../fixtures/electron.mjs';

const SITO = 'negoziofelice.it';

function docFinto({ intent, initialUrl, selector, success = true }) {
  return {
    document: {
      name: `projects/p/databases/(default)/documents/paths/${SITO}/entries/${Math.random().toString(36).slice(2)}`,
      createTime: '2026-09-15T04:00:00.123456Z',
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

test('per leggere bisogna nominare un sito: la raccolta intera non è una domanda che si possa fare', async ({ app }) => {
  const r = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [docFinto({ intent: 'aprire la pagina degli ordini', initialUrl: '/account/ordini', selector: '[aria-label="I miei ordini"]' })],
  });
  expect(r.richieste.length).toBe(1);
  // Il nome del sito è un PEZZO dell'indirizzo, non un filtro dentro la domanda:
  // la domanda gira SOTTO quel documento, e `entries` è la sottoraccolta.
  expect(r.richieste[0].u).toContain(`/documents/paths/${SITO}:runQuery`);
  const corpo = JSON.stringify(r.richieste[0].corpo);
  expect(corpo).not.toContain('domain');
  expect(r.richieste[0].corpo.structuredQuery.from).toEqual([{ collectionId: 'entries' }]);
  // E nessuna domanda di gruppo: `allDescendants` rimetterebbe insieme la raccolta.
  expect(corpo).not.toContain('allDescendants');
  // E un tetto c'è sempre: le regole rifiutano una lettura che non lo dichiari.
  expect(r.richieste[0].corpo.structuredQuery.limit).toBeGreaterThan(0);
  expect(r.richieste[0].corpo.structuredQuery.limit).toBeLessThanOrEqual(200);
});

test('e i percorsi già riusciti di quel sito arrivano davvero nel messaggio di sistema', async ({ app }) => {
  const r = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [
      docFinto({ intent: 'aprire la pagina degli ordini', initialUrl: '/account/ordini', selector: '[aria-label="I miei ordini"]' }),
      docFinto({ intent: 'annullare un ordine', initialUrl: '/account/ordini', selector: '[aria-label="Annulla ordine"]', success: false }),
    ],
  });
  expect(r.sistema).toContain('aprire la pagina degli ordini');
  expect(r.sistema).toContain('I miei ordini');
  expect(r.sistema).toContain('CONTENUTO ESTERNO');
  // Il percorso bocciato non arriva a chi legge.
  expect(r.sistema).not.toContain('annullare un ordine');
  // E l'ora che Firestore appiccica a ogni documento non entra nel prompt.
  expect(r.sistema).not.toContain('2026-09-15T04:00:00');
});

test('un sito senza percorsi non è un errore, è un elenco vuoto', async ({ app }) => {
  const r = await chiediAiuto(app, { url: `https://${SITO}/`, righe: [] });
  expect(r.sistema).not.toContain('PERCORSI_CONDIVISI');
  expect(r.sistema.length).toBeGreaterThan(0);
});

test('chi legge e chi scrive decidono il nome del sito con la stessa regola', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const P = globalThis.SN_PATHS;
    const nomi = [
      'esempio.it', 'ESEMPIO.IT', 'esempio.it.', 'www.esempio.it', 'a.b.c.esempio.it',
      'xn--mnchen-3ya.de', 'sito.co.uk',
      'mio_sito.it', '-sito.it', 'esempio.it/altro', 'esempio it', '',
      'localhost', 'app.localhost', 'progetto-rossi.test', 'nas.local', 'router.lan',
      'sito.invalid', 'sito.example', 'qualcosa.onion', 'qualcosa.alt', 'qualcosa.i2p',
      '192.168.1.1', '[::1]', 'options', '__proto__', '..',
      `${'a'.repeat(260)}.localhost`,
    ];
    return nomi.map((n) => ({ n, scrive: S._internal.sanitizeDomain(n), legge: P._internal.segmentoDominio(n) }));
  });
  for (const riga of r) {
    expect(`${riga.n} -> ${riga.legge}`).toBe(`${riga.n} -> ${riga.scrive}`);
  }
  // E i siti che non sono di nessuno restano fuori da tutte e due le porte.
  const fuori = r.filter((x) => /localhost|\.test$|\.local$|\.lan$|invalid|example$|onion|alt$|i2p|192\.168|::1|^options$|__proto__|^\.\.$|^$/.test(x.n));
  for (const riga of fuori) expect(`${riga.n}:${riga.legge}`).toBe(`${riga.n}:`);
});

test('un nome di sito scritto male non tocca nemmeno la rete', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const P = globalThis.SN_PATHS;
    const fetchVero = globalThis.fetch;
    let chiamate = 0;
    globalThis.fetch = async (u) => {
      // Solo le richieste ALLA RACCOLTA contano: l'app ne fa altre per conto suo.
      if (String(u).includes('/documents/paths')) chiamate += 1;
      return new Response('[]', { status: 200 });
    };
    const esiti = [];
    for (const d of ['', '   ', '/', '..', '../..', 'esempio.it/altro', 'https://esempio.it',
      '<script>alert(1)</script>', '🙂.it', 'a'.repeat(400), 'mio_sito.it', 'localhost']) {
      esiti.push({ d, n: (await P.listByDomain(d)).length });
    }
    globalThis.fetch = fetchVero;
    return { esiti, chiamate };
  });
  expect(r.chiamate).toBe(0);
  for (const e of r.esiti) expect(`${e.d}:${e.n}`).toBe(`${e.d}:0`);
});

test('quello che parte dal computer di chi naviga non porta niente del mittente, e non parte adesso', async ({ app }) => {
  const voce = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0.5);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    await C.collectAndSave({
      session: {
        rawUrl: 'https://negoziofelice.it/account/ordini?token=segreto#qui',
        rawSteps: [{ selector: '[aria-label="I miei ordini"]', action: 'click' }],
        rawUserMessages: ['dove trovo i miei ordini?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'aprire la pagina degli ordini' }
        : { text: '{"ok": true}' }),
    });
    const coda = C._peek();
    P.submit = vero;
    C._reset();
    return coda[coda.length - 1] || null;
  });
  expect(voce).not.toBeNull();
  const testo = JSON.stringify(voce).toLowerCase();
  expect(testo).not.toContain('clientid');
  expect(testo).not.toContain('useragent');
  expect(testo).not.toContain('mozilla');
  // La parte dopo il punto interrogativo e il frammento non escono.
  expect(voce.initialUrl).toBe('/account/ordini');
  expect(testo).not.toContain('segreto');
  // E l'uscita è staccata dall'ora della sessione.
  expect(voce.nonPrimaDi - voce.accodatoIl).toBeGreaterThanOrEqual(30 * 60 * 1000);
});
