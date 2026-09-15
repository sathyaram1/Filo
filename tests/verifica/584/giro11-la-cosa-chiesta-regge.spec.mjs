// #584, undicesimo giro — la cosa che il feedback chiedeva, ri-provata dal capo
// di chi la usa.
//
// Il feedback chiedeva due cose verificabili: che la lettura anonima
// dell'intera raccolta non sia più possibile, e che «i percorsi già riusciti»
// dell'assistente di pagina continuino a funzionare su un sito che ne ha.
//
// Il motore vero delle regole in questo contenitore non c'è (mancano la riga
// di comando di Firebase e la libreria di prova). Il file delle regole però non
// è cambiato dal giro che le ha aperte porta per porta col motore vero, quindi
// qui si guarda l'altra metà: la richiesta che il client sa COSTRUIRE. Se il
// nome del sito è un pezzo dell'indirizzo e non un filtro dentro la domanda,
// non esiste una forma della richiesta che rimetta insieme la raccolta.

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

test('per leggere bisogna nominare un sito, e il nome è un pezzo dell’indirizzo', async ({ app }) => {
  const r = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [docFinto({ intent: 'annullare un ordine', initialUrl: '/account/ordini', selector: 'Annulla ordine' })],
  });
  expect(r.richieste.length).toBe(1);
  // Il nome del sito sta NELL'INDIRIZZO della richiesta…
  expect(r.richieste[0].u).toContain(`/documents/paths/${SITO}:runQuery`);
  // …e non è un filtro dentro la domanda, che rimetterebbe insieme tutti i siti.
  const corpo = JSON.stringify(r.richieste[0].corpo);
  expect(corpo).not.toContain('domain');
  expect(r.richieste[0].corpo.structuredQuery.from[0].collectionId).toBe('entries');
  expect(r.richieste[0].corpo.structuredQuery.from[0].allDescendants).toBeFalsy();
  // Il tetto lo rispetta il client da sé, e l'esito lo filtra il server.
  expect(r.richieste[0].corpo.structuredQuery.limit).toBeLessThanOrEqual(200);
  expect(corpo).toContain('success');
});

test('e i percorsi già riusciti del sito arrivano davanti all’assistente, dichiarati roba di fuori', async ({ app }) => {
  const r = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [
      docFinto({ intent: 'annullare un ordine', initialUrl: '/account/ordini', selector: 'Annulla ordine' }),
      docFinto({ intent: 'chiedere un rimborso', initialUrl: '/account/resi', selector: 'Apri un reso' }),
    ],
  });
  expect(r.sistema).toContain('<<<PERCORSI_CONDIVISI>>>');
  expect(r.sistema).toContain('<<<FINE_PERCORSI_CONDIVISI>>>');
  expect(r.sistema).toContain('"annullare un ordine" (da /account/ordini)');
  expect(r.sistema).toContain('click su Annulla ordine');
  expect(r.sistema).toContain('"chiedere un rimborso" (da /account/resi)');
  expect(r.sistema).toContain('CONTENUTO ESTERNO');
  // L'ora che il database appiccica a ogni documento non entra nel prompt.
  expect(r.sistema).not.toContain('2026-09-15T04:00:00.123456Z');
});

test('un sito senza percorsi non apre nemmeno il blocco, e non è un errore', async ({ app }) => {
  const r = await chiediAiuto(app, { url: `https://${SITO}/account/ordini`, righe: [] });
  expect(r.sistema).not.toContain('<<<PERCORSI_CONDIVISI>>>');
  expect(r.sistema.length).toBeGreaterThan(0);
});

test('il percorso bocciato non arriva a chi legge', async ({ app }) => {
  const r = await chiediAiuto(app, {
    url: `https://${SITO}/account/ordini`,
    righe: [
      docFinto({ intent: 'una strada che non ha funzionato', initialUrl: '/account/ordini', selector: 'Pulsante sbagliato', success: false }),
      docFinto({ intent: 'annullare un ordine', initialUrl: '/account/ordini', selector: 'Annulla ordine' }),
    ],
  });
  expect(r.sistema).toContain('annullare un ordine');
  expect(r.sistema).not.toContain('una strada che non ha funzionato');
});

test('quello che parte non dice chi è stato, e non parte quando l’utente risponde', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    const prima = Date.now();
    await C.collectAndSave({
      session: {
        rawUrl: 'https://negoziofelice.it/account/ordini',
        rawSteps: [{ selector: '[aria-label="Annulla ordine"]', action: 'click' }],
        rawUserMessages: ['come annullo un ordine?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'annullare un ordine' }
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
  // Nessun campo che dica chi è stato: né codice del mittente né user agent.
  const chiavi = Object.keys(voce).join(',');
  expect(chiavi).not.toMatch(/client|user-?agent|uid|token|ip/i);
  expect(JSON.stringify(voce)).not.toContain('come annullo');
  // E non parte adesso: la partenza è sorteggiata ad almeno mezz'ora.
  expect(voce.nonPrimaDi - esito.prima).toBeGreaterThanOrEqual(29 * 60 * 1000);
  expect(esito.rimasti).toBe(1);
});

test('un nome di sito scritto male non tocca nemmeno la rete', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const fetchVero = globalThis.fetch;
    let toccata = 0;
    globalThis.fetch = async (u) => {
      if (String(u).includes('/documents/paths')) toccata += 1;
      return new Response('[]', { status: 200 });
    };
    const out = {};
    for (const d of ['', '   ', 'negozio/felice.it', 'https://negoziofelice.it/ordini', '..', 'a'.repeat(400), '<b>x</b>', '🙂.it', '__id__']) {
      out[JSON.stringify(d)] = (await globalThis.SN_PATHS.listByDomain(d)).length;
    }
    globalThis.fetch = fetchVero;
    return { out, toccata };
  });
  expect(r.toccata).toBe(0);
  for (const [d, n] of Object.entries(r.out)) expect(`${d} -> ${n}`).toBe(`${d} -> 0`);
});
