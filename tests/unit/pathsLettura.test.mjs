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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'paths.js'));
const P = globalThis.SN_PATHS;

const BASE = (P.rest && P.rest.FIRESTORE_BASE)
  // Il ripiego serve alla CONTROPROVA (tests/verifica/584): col client di
  // prima `rest` non esiste, e senza questo il file morirebbe al caricamento
  // invece di far vedere QUALI asserzioni diventano rosse.
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
    assert.equal(body.structuredQuery.where, undefined,
      'non serve più nessun filtro `domain == …`: il dominio è nel percorso');
    assert.ok(body.structuredQuery.limit <= P.rest.MAX_PAGE_SIZE);
  });
});

test('una richiesta più grande del tetto viene ridotta, non rifiutata dalle regole', async () => {
  await withFetch(() => [], async (calls) => {
    await P.listByDomain('esempio.it', { pageSize: 100000 });
    assert.equal(calls[0].body.structuredQuery.limit, P.rest.MAX_PAGE_SIZE);
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
    const prompt = P.formatForPrompt(out);
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

test('niente percorsi, niente blocco nel prompt (e due volte lo stesso percorso conta una)', () => {
  assert.equal(P.formatForPrompt([]), '');
  assert.equal(P.formatForPrompt(null), '');
  const uguali = [
    { initialUrl: '/a', intent: 'x', steps: [{ selector: '#s', action: 'click' }] },
    { initialUrl: '/a', intent: 'y', steps: [{ selector: '#s', action: 'click' }] },
  ];
  assert.equal(P.formatForPrompt(uguali).split('##').length - 1, 1);
});

test('il prompt si ferma al suo tetto di caratteri', () => {
  const tanti = Array.from({ length: 200 }, (_, i) => ({
    initialUrl: `/p${i}`, intent: 'x'.repeat(100), steps: [{ selector: '#s' + i, action: 'click' }],
  }));
  const out = P.formatForPrompt(tanti, { budgetChars: 500 });
  assert.ok(out.length <= 500, `prompt lungo ${out.length}, oltre il tetto`);
  assert.ok(out.length > 0);
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

test('il percorso salvato non porta nessun identificativo del mittente', async () => {
  await withFetch(() => ({ name: 'projects/p/databases/(default)/documents/paths/esempio.it/entries/nuovo' }), async (calls) => {
    const { id } = await P.submit({
      domain: 'Esempio.it',
      initialUrl: '/account',
      intent: 'disdire l’abbonamento',
      steps: [{ selector: '#menu', action: 'click', retracted: false }],
      success: true,
    });
    assert.equal(id, 'nuovo');
    const { url, body } = calls[0];
    assert.equal(url.split('?')[0], `${BASE}/paths/esempio.it/entries`);
    assert.deepEqual(Object.keys(body.fields).sort(),
      ['createdAt', 'initialUrl', 'intent', 'steps', 'success'].sort());
    assert.ok(!('clientId' in body.fields), 'clientId è tornato nel documento');
    assert.ok(!('userAgent' in body.fields), 'userAgent è tornato nel documento');
    assert.ok(!('domain' in body.fields), 'il dominio sta nel percorso, non nel documento');
  });
});

test('l’ora del percorso è arrotondata: l’orario esatto sarebbe una chiave per ricucire domini diversi', async () => {
  await withFetch(() => ({ name: 'a/b/c' }), async (calls) => {
    await P.submit({
      domain: 'esempio.it', initialUrl: '/', intent: 'x', steps: [], success: true,
      now: Date.parse('2026-09-11T14:37:52.431Z'),
    });
    assert.equal(calls[0].body.fields.createdAt.timestampValue, '2026-09-11T14:00:00.000Z');
  });
});

test('un dominio non valido non scrive da nessuna parte: si ferma con un errore', async () => {
  await withFetch(() => ({}), async (calls) => {
    await assert.rejects(
      () => P.submit({ domain: 'esempio.it/altro', initialUrl: '/', intent: 'x', steps: [], success: true }),
      /dominio non valido/);
    assert.equal(calls.length, 0);
  });
});

test('un errore di Firestore in lettura si vede: non torna una lista vuota', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'PERMISSION_DENIED', json: async () => ({}) });
  try {
    await assert.rejects(() => P.listByDomain('esempio.it'), /403/);
  } finally {
    globalThis.fetch = orig;
  }
});
