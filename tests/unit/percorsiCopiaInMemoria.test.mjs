// La copia in memoria dei percorsi condivisi (#679): l'agente Aiuto li rilegge
// a ogni turno sulla stessa pagina, e ogni rilettura era `limit` letture di
// Firestore — trenta turni al giorno facevano millecinquecento letture per
// persona, per un elenco che cambia di rado.
//
// Quattro cose devono restare vere: due richieste ravvicinate sono UNA lettura,
// scaduto il tempo si rilegge, un percorso appena spedito per quel dominio
// butta la copia subito, e una rete caduta non sostituisce la copia buona con
// il nulla.
//
// Senza il fix è rosso: ogni chiamata partiva verso Firestore.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'pathsSafety.js'));
require(join(ROOT, 'src', 'shared', 'paths.js'));

const P = globalThis.SN_PATHS;
const TTL = P.rest.CACHE_TTL_MS;

let orologio = 0;

beforeEach(() => {
  P._internal.svuotaCache();
  orologio = 1_000_000;
  P._internal._setAdesso(() => orologio);
});

function fsDoc(id, intent) {
  return {
    document: {
      name: `paths/esempio.it/entries/${id}`,
      fields: {
        initialUrl: { stringValue: '/ordini' },
        intent: { stringValue: intent },
        steps: { arrayValue: { values: [{ mapValue: { fields: {
          selector: { stringValue: '#ordini' }, action: { stringValue: 'click' }, retracted: { booleanValue: false },
        } } }] } },
        success: { booleanValue: true },
        createdAt: { timestampValue: '2026-09-01T10:00:00.000Z' },
      },
    },
  };
}

// fetch finta: conta le letture e risponde quello che le si dice.
function conRete(risposta, fn) {
  const letture = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    letture.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    return risposta(String(url), letture.length);
  };
  return fn(letture).finally(() => { globalThis.fetch = orig; });
}

const ok = (righe) => async () => ({ ok: true, status: 200, json: async () => righe, text: async () => '' });

test('due richieste ravvicinate sullo stesso dominio sono UNA lettura sola', async () => {
  await conRete(ok([fsDoc('a', 'vedere gli ordini')]), async (letture) => {
    const primo = await P.listByDomain('esempio.it', { onlySuccess: true });
    orologio += 60_000;
    const secondo = await P.listByDomain('esempio.it', { onlySuccess: true });
    assert.equal(letture.length, 1, 'la seconda richiesta doveva arrivare dalla copia in memoria');
    assert.deepEqual(secondo, primo, 'e deve rendere gli stessi percorsi della prima');
  });
});

test('un dominio diverso non si serve dalla copia di un altro', async () => {
  await conRete(ok([fsDoc('a', 'vedere gli ordini')]), async (letture) => {
    await P.listByDomain('esempio.it');
    await P.listByDomain('altro.it');
    assert.equal(letture.length, 2);
  });
});

test('scaduto il tempo la copia si rilegge', async () => {
  await conRete(ok([fsDoc('a', 'vedere gli ordini')]), async (letture) => {
    await P.listByDomain('esempio.it', { onlySuccess: true });
    orologio += TTL + 1;
    await P.listByDomain('esempio.it', { onlySuccess: true });
    assert.equal(letture.length, 2);
  });
});

test('il percorso appena spedito si rivede subito: l’invio butta la copia di quel dominio', async () => {
  const orig = globalThis.fetch;
  const letture = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    letture.push(u);
    if (u.includes('pathSubmit')) {
      return { ok: true, status: 200, json: async () => ({ result: { saved: true, id: 'nuovo' } }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [fsDoc('a', 'vedere gli ordini')], text: async () => '' };
  };
  try {
    await P.listByDomain('esempio.it', { onlySuccess: true });
    await P.submit({
      domain: 'esempio.it', initialUrl: 'https://esempio.it/ordini', intent: 'vedere gli ordini',
      steps: [{ selector: '#ordini', action: 'click' }], success: true, clientId: 'x',
    });
    await P.listByDomain('esempio.it', { onlySuccess: true });
    const query = letture.filter((u) => u.includes('runQuery'));
    assert.equal(query.length, 2, 'dopo un invio per quel dominio la copia non vale più');
  } finally {
    globalThis.fetch = orig;
  }
});

test('l’invio di un ALTRO dominio non butta la copia di questo', async () => {
  const orig = globalThis.fetch;
  const letture = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    letture.push(u);
    if (u.includes('pathSubmit')) {
      return { ok: true, status: 200, json: async () => ({ result: { saved: true, id: 'nuovo' } }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [fsDoc('a', 'vedere gli ordini')], text: async () => '' };
  };
  try {
    await P.listByDomain('esempio.it', { onlySuccess: true });
    await P.submit({
      domain: 'altro.it', initialUrl: 'https://altro.it/x', intent: 'altra cosa',
      steps: [{ selector: '#x', action: 'click' }], success: true, clientId: 'x',
    });
    await P.listByDomain('esempio.it', { onlySuccess: true });
    assert.equal(letture.filter((u) => u.includes('runQuery')).length, 1);
  } finally {
    globalThis.fetch = orig;
  }
});

test('una rete caduta non avvelena la copia buona: l’agente vede ancora i percorsi', async () => {
  const orig = globalThis.fetch;
  let caduta = false;
  globalThis.fetch = async () => {
    if (caduta) return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) };
    return { ok: true, status: 200, json: async () => [fsDoc('a', 'vedere gli ordini')], text: async () => '' };
  };
  try {
    const buono = await P.listByDomain('esempio.it', { onlySuccess: true });
    assert.equal(buono.length, 1);
    caduta = true;
    orologio += TTL + 1;
    const dopo = await P.listByDomain('esempio.it', { onlySuccess: true });
    assert.deepEqual(dopo, buono, 'con la rete giù si serve la copia buona, non una lista vuota');
    caduta = false;
    orologio += 1;
    const tornata = await P.listByDomain('esempio.it', { onlySuccess: true });
    assert.deepEqual(tornata, buono, 'e quando la rete torna si rilegge senza restare fermi sull’errore');
  } finally {
    globalThis.fetch = orig;
  }
});

test('chi riceve i percorsi non può modificare la copia condivisa', async () => {
  await conRete(ok([fsDoc('a', 'vedere gli ordini')]), async () => {
    const primo = await P.listByDomain('esempio.it', { onlySuccess: true });
    primo.length = 0;
    const secondo = await P.listByDomain('esempio.it', { onlySuccess: true });
    assert.equal(secondo.length, 1);
  });
});

test('si chiedono tanti percorsi quanti ne entrano nel prompt, non cinquanta', async () => {
  const Safety = globalThis.SN_PATHS_SAFETY;
  assert.ok(P.rest.DEFAULT_PAGE_SIZE <= 30,
    'il prompt dell’Aiuto ne imbusta una trentina prima di finire il tetto: chiederne di più è pagare letture che nessuno legge');
  await conRete(ok([]), async (letture) => {
    await P.listByDomain('esempio.it', { onlySuccess: true });
    assert.equal(letture[0].body.structuredQuery.limit, P.rest.DEFAULT_PAGE_SIZE);
  });
  // E il numero scelto sta davvero dentro il tetto del prompt, coi percorsi
  // grossi come quelli veri: se il tetto scende, questo test lo dice.
  const finti = Array.from({ length: P.rest.DEFAULT_PAGE_SIZE }, (_, i) => ({
    domain: 'esempio.it', initialUrl: 'https://esempio.it/area',
    intent: `cosa numero ${i}`,
    steps: Array.from({ length: 8 }, (_, k) => ({ action: 'click', selector: `Pulsante ${i}-${k} ${'x'.repeat(40)}` })),
    success: true,
  }));
  const prompt = Safety.formatKnownPathsForPrompt(finti);
  assert.ok(prompt.length <= Safety.LIMITI.KNOWN_PATHS_BUDGET_CHARS);
});
