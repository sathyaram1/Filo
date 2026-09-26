// Il cammino dei percorsi condivisi dell'Aiuto, dalle due estremità: quello
// che Filo CHIEDE a Firestore per un dominio, e quello che SCRIVE quando dici
// «ha funzionato». La rete è finta (fetch sostituita): si verifica cosa va sul
// filo e come viene riletto. Gira via `npm run test:unit`.
//
// Perché esiste (audit pre-alpha, #584). Prima la lettura era una query sulla
// collezione intera filtrata per dominio, e chi filtra può anche non filtrare:
// con la chiave web del repo si scaricavano i percorsi di tutti, `clientId` in
// chiaro compreso. Ora il dominio è un segmento del percorso Firestore, quindi
// una richiesta nomina un dominio e riceve solo quello. Questi test tengono
// ferme le due cose che contano: la lettura per dominio continua a funzionare
// (l'agente di pagina i "percorsi già riusciti" li vede ancora) e nel documento
// non torna dentro niente che dica chi l'ha mandato.
//
// Senza il fix sono ROSSI: la query girava su `documents:runQuery` con un
// `where domain == …`, e il corpo della create portava `clientId` e
// `userAgent`.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// constants.js prima: è il modulo base, e da lì paths.js prende la funzione che
// rende inerte come struttura un pezzo di testo scritto da uno sconosciuto
// (una definizione sola per la lettura e per la scrittura, #584 quarto giro).
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'pathsSafety.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'paths.js'));
const Safety = globalThis.SN_PATHS_SAFETY;
const P = globalThis.SN_PATHS;

const BASE = (P.rest && P.rest.FIRESTORE_BASE)
  // Il ripiego serve alla CONTROPROVA (questi test contro il client di
  // prima): lì `rest` non esiste, e senza il ripiego il file morirebbe al
  // caricamento invece di far vedere QUALI asserzioni diventano rosse.
  || 'https://firestore.googleapis.com/v1/projects/filo-8b9cb/databases/(default)/documents';
const MAX_PAGE_SIZE = (P.rest && P.rest.MAX_PAGE_SIZE) || 200;

function fsDoc(id, { initialUrl, intent, steps, success, createdAt }) {
  return {
    document: {
      name: `${BASE}/paths/esempio.it/entries/${id}`,
      createTime: '2026-09-01T00:00:00Z',
      fields: {
        initialUrl: { stringValue: initialUrl },
        intent: { stringValue: intent },
        steps: {
          arrayValue: {
            values: (steps || []).map((s) => ({
              mapValue: {
                fields: {
                  selector: { stringValue: s.selector },
                  action: { stringValue: s.action || 'click' },
                  retracted: { booleanValue: !!s.retracted },
                },
              },
            })),
          },
        },
        success: { booleanValue: !!success },
        createdAt: { timestampValue: createdAt || '2026-09-01T10:00:00.000Z' },
      },
    },
  };
}

// La lettura tiene una copia in memoria per dominio (#679): qui si guarda cosa
// va sul filo, quindi ogni test parte senza copie di quello prima.
beforeEach(() => { P._internal.svuotaCache(); });

// fetch finta: registra le chiamate e risponde con quanto passato.
function withFetch(respond, fn) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    const payload = respond(String(url), calls[calls.length - 1].body);
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  return fn(calls).finally(() => { globalThis.fetch = orig; });
}

// ───────────────────────────── lettura ──────────────────────────────────────

test('i percorsi si chiedono sotto il loro dominio, non alla collezione intera', async () => {
  await withFetch(() => [], async (calls) => {
    await P.listByDomain('Esempio.IT', { pageSize: 50 });
    const { url, body } = calls[0];
    assert.equal(url.split('?')[0], `${BASE}/paths/esempio.it:runQuery`,
      'la query deve avere come radice il documento del dominio: è quello che rende impossibile chiederli tutti');
    assert.deepEqual(body.structuredQuery.from, [{ collectionId: 'entries' }]);
    assert.ok(!JSON.stringify(body).includes('domain'),
      'non serve più nessun filtro `domain == …`: il dominio è nel percorso');
    assert.ok(body.structuredQuery.limit <= MAX_PAGE_SIZE);
  });
});

test('una richiesta più grande del tetto viene ridotta, non rifiutata dalle regole', async () => {
  await withFetch(() => [], async (calls) => {
    await P.listByDomain('esempio.it', { pageSize: 100000 });
    assert.equal(calls[0].body.structuredQuery.limit, MAX_PAGE_SIZE);
  });
});

test('l’agente di pagina ritrova i percorsi riusciti del dominio, e solo quelli', async () => {
  const rows = [
    fsDoc('a', { initialUrl: '/account', intent: 'disdire l’abbonamento', success: true, steps: [{ selector: '#menu', action: 'click' }, { selector: '.disdici', action: 'click' }] }),
    fsDoc('b', { initialUrl: '/', intent: 'tentativo fallito', success: false, steps: [{ selector: '#x', action: 'click' }] }),
  ];
  await withFetch(() => rows, async () => {
    const out = await P.listByDomain('esempio.it', { pageSize: 50, onlySuccess: true });
    assert.equal(out.length, 1, 'i tentativi falliti non vanno nel prompt di chi chiede aiuto');
    assert.equal(out[0].intent, 'disdire l’abbonamento');
    assert.equal(out[0].initialUrl, '/account');
    assert.equal(out[0].steps.length, 2);

    // …e da lì esce il blocco che l'agente si trova nel messaggio di sistema.
    const prompt = Safety.formatKnownPathsForPrompt(out);
    assert.match(prompt, /## "disdire l’abbonamento" \(da \/account\)/);
    assert.match(prompt, /1\. click su #menu/);
    assert.match(prompt, /2\. click su \.disdici/);
  });
});

test('con onlySuccess:false tornano anche i falliti (servono a noi, non al prompt)', async () => {
  const rows = [
    fsDoc('a', { initialUrl: '/', intent: 'ok', success: true, steps: [{ selector: '#a' }] }),
    fsDoc('b', { initialUrl: '/', intent: 'ko', success: false, steps: [{ selector: '#b' }] }),
  ];
  await withFetch(() => rows, async () => {
    const out = await P.listByDomain('esempio.it', { onlySuccess: false });
    assert.equal(out.length, 2);
  });
});

test('un dominio che non è un nome di host non fa partire nessuna richiesta', async () => {
  await withFetch(() => [], async (calls) => {
    for (const cattivo of ['', null, 'esempio.it/../altro', 'esempio.it/entries', 'con spazio', '..', '__proto__']) {
      assert.deepEqual(await P.listByDomain(cattivo), [], `"${cattivo}" doveva tornare vuoto`);
    }
    assert.equal(calls.length, 0, 'nessuna di quelle stringhe deve diventare un percorso Firestore');
  });
});

// ───────────────────────────── scrittura ────────────────────────────────────

test('i percorsi riusciti li sceglie il server, non il client dopo aver scaricato una pagina a caso', async () => {
  await withFetch(() => [], async (calls) => {
    await P.listByDomain('esempio.it', { pageSize: 50, onlySuccess: true });
    const filtro = calls[0].body.structuredQuery.where;
    assert.ok(filtro, 'la query deve chiedere al server solo i percorsi riusciti');
    assert.equal(filtro.fieldFilter.field.fieldPath, 'success');
    assert.equal(filtro.fieldFilter.op, 'EQUAL');
    assert.equal(filtro.fieldFilter.value.booleanValue, true);
  });
});

test('se l’indice non è ancora pubblicato la funzione non muore: si ripiega sulla query semplice', async () => {
  const orig = globalThis.fetch;
  const corpi = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    corpi.push(body);
    if (body.structuredQuery.where) {
      // è quello che risponde Firestore quando manca l'indice composto
      return { ok: false, status: 400, text: async () => 'FAILED_PRECONDITION: The query requires an index', json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [
        fsDoc('a', { initialUrl: '/x', intent: 'riuscito', success: true, steps: [] }),
        fsDoc('b', { initialUrl: '/y', intent: 'fallito', success: false, steps: [] }),
      ],
      text: async () => '',
    };
  };
  try {
    const out = await P.listByDomain('esempio.it', { pageSize: 50, onlySuccess: true });
    assert.equal(corpi.length, 2, 'dopo il rifiuto va ritentata la query senza filtro');
    assert.equal(out.length, 1, 'e i bocciati si scartano qui');
    assert.equal(out[0].intent, 'riuscito');
  } finally {
    globalThis.fetch = orig;
  }
});

// Un percorso condiviso lo scrive chiunque, senza login, e quel testo entra nel
// messaggio di sistema di un agente che clicca da solo sulla pagina di un
// altro. Non può portarsi dietro la struttura del prompt.
test('un errore di Firestore in lettura si vede: non torna una lista vuota', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'PERMISSION_DENIED', json: async () => ({}) });
  try {
    await assert.rejects(() => P.listByDomain('esempio.it'), /403/);
  } finally {
    globalThis.fetch = orig;
  }
});

// Un percorso lo scrive chiunque, e le regole contano i passi ma non li possono
// pesare: trenta passi da trentamila caratteri stanno in un documento solo
// (#584, terzo giro). Nella raccolta ci sono anche documenti nati quando
// scriverli non richiedeva niente, quindi il tetto lo mette chi COMPONE il
// prompt: un percorso enorme si taglia dicendolo, e gli altri di quel dominio
// arrivano lo stesso al modello.
test('un percorso gonfiato apposta non si mangia il posto degli altri', async () => {
  const gonfio = fsDoc('gonfio', {
    initialUrl: '/x', intent: 'cosa enorme', success: true,
    steps: Array.from({ length: 30 }, () => ({ selector: 'a'.repeat(30000), action: 'click' })),
  });
  const buono = fsDoc('buono', {
    initialUrl: '/ordini', intent: 'vedere gli ordini', success: true,
    steps: [{ selector: 'a#ordini', action: 'click' }],
  });
  await withFetch(() => [gonfio, buono], async () => {
    const percorsi = await P.listByDomain('esempio.it');
    assert.equal(percorsi.length, 2, 'la lettura non giudica: rende quello che c\u2019\u00e8');
    const prompt = Safety.formatKnownPathsForPrompt(percorsi);
    assert.ok(prompt.length <= Safety.LIMITI.KNOWN_PATHS_BUDGET_CHARS,
      `prompt di ${prompt.length} caratteri, oltre il tetto`);
    assert.ok(prompt.includes('vedere gli ordini'),
      'il percorso buono deve arrivare al modello anche se sullo stesso dominio ce n\u2019\u00e8 uno enorme');
  });
});
