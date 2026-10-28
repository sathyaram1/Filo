// I contatori dei riquadri AI e dell'Editor (#1465): ogni voce viene dai suoi elenchi chiusi e un testo passato per
// sbaglio non esce; il documento parte accanto all'ora, mai in incognito né a contatori spenti; chi manda dalle pagine
// usa solo misure e chiavi dell'elenco. Le regole: firestoreRulesContatori.test.mjs; l'app vera: contatori-riquadri.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const C = globalThis.SN_CONTATORI;
const A = globalThis.SN_CONST.ACTIONS;
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';
const ORA = 60 * 60 * 1000;
const T0 = new Date(2026, 9, 15, 9, 0, 0).getTime();
const attendi = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

function daFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(daFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, daFs(x)]));
  throw new Error(`tipo inatteso ${JSON.stringify(v)}`);
}

function banco({ accesi = true, incognito = false } = {}) {
  const disco = new Map();
  const per = { ore: [], riquadri: [], altro: [] };
  const b = { t: T0, accesi, incognito, disco, per, n: 0 };
  b.s = Servizio.crea({
    contatori: C,
    storage: {
      getRaw: async (k, d) => (disco.has(k) ? JSON.parse(JSON.stringify(disco.get(k))) : d),
      setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
    },
    impostazioni: async () => ({ contatori: { attivi: b.accesi } }),
    inIncognito: () => b.incognito,
    runNormale: (fn) => fn(),
    finestraNormale: () => true,
    adesso: () => b.t,
    versione: () => '0.2.249',
    piattaforma: 'linux',
    esclusi: async () => [],
    casuale: () => `${'7'.repeat(18)}${String(++b.n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }),
    fetch: async (url, opt) => {
      const doc = Object.fromEntries(Object.entries(JSON.parse(opt.body).fields).map(([k, v]) => [k, daFs(v)]));
      const dove = url.includes(`/${C.COLLEZIONE_RIQUADRI}?`) ? 'riquadri' : url.includes(`/${C.COLLEZIONE}?`) ? 'ore' : 'altro';
      per[dove].push({ url, doc });
      return { ok: true, status: 200, json: async () => ({}) };
    },
    log: () => {},
  });
  return b;
}
const v = (misura, dati) => C.voceRiquadro(misura, dati);

test('ogni messaggio diventa la voce dei suoi elenchi, e quello che non lo è non si conta', () => {
  assert.deepEqual(v('anticipo_al_gesto', { funzione: 'spiega', stato: 'in_volo' }), { misura: 'anticipo_al_gesto', chiave: 'spiega', voci: ['in_volo'] });
  assert.deepEqual(v('riquadro_chiuso_prima', { action: A.EXPLAIN_DEEP, attesaMs: 2500 }).voci, ['s5']);
  assert.equal(v('riquadro_chiuso_prima', { action: A.DESCRIBE_IMAGE, attesaMs: 10 }).chiave, 'describe-image');
  assert.equal(v('riquadro_chiuso_prima', { action: A.EDITOR_CHAT, attesaMs: 10 }), null, 'la chat dell’Editor non è un riquadro sulla pagina');
  assert.deepEqual(v('riquadro_uso', { action: A.TRANSLATE_SELECTION, domande: 0 }).voci, ['d0']);
  assert.deepEqual(v('riquadro_uso', { action: A.TRANSLATE_SELECTION, domande: 7 }).voci, ['d3_oltre']);
  assert.deepEqual(v('riquadro_uso', { action: A.EXPLAIN, uso: 'approfondisci' }).voci, ['approfondisci']);
  assert.deepEqual(v('riscrittura', { scorciatoia: 'riassumi', esito: 'copiato', proposte: 2 }).voci, ['copiato|p2']);
  assert.deepEqual(v('riscrittura', { scorciatoia: 'libera', esito: 'chiuso', proposte: 9 }).voci, ['chiuso|p3_oltre']);
  assert.deepEqual(v('riscrittura', { scorciatoia: 'formale', tagliata: true }).voci, ['tagliata']);
  assert.equal(v('riscrittura', { scorciatoia: 'formale', esito: 'chiuso', proposte: 0 }), null, 'senza una proposta non c’è un esito');
  assert.deepEqual(v('ocr', { esito: 'vuoto' }), { misura: 'ocr', chiave: 'vuoto', voci: ['n'] });
  assert.deepEqual(v('traduzione_pagina', { esito: 'intera', rimasto: 0, originale: false }).voci, ['r10|no']);
  assert.deepEqual(v('traduzione_pagina', { esito: 'fermata', rimasto: 1, originale: true }).voci, ['oltre|si']);
  assert.equal(v('traduzione_pagina', { esito: 'parziale', rimasto: 0.3 }), null, 'il ritorno all’originale si sa o non si conta');
  assert.deepEqual(v('editor_titolo', { via: 'rigenerato', esito: 'vuoto' }).voci, ['vuoto']);
  assert.deepEqual(v('editor_titolo', { via: 'automatico', riscrittoDopoMs: 3 * 24 * ORA }).voci, ['riscritto_mese']);
  assert.deepEqual(v('editor_chat', { oltreTetto: true, formati: 3 }), { misura: 'editor_chat', chiave: 'oltre_tetto', voci: ['f2_5'] });
  assert.deepEqual(v('editor_chat', { oltreTetto: false, nonTrovato: true }).voci, ['formato_non_trovato']);
  assert.deepEqual(v('editor_chat', { oltreTetto: false, continua: true }).voci, ['continua']);
  assert.equal(v('editor_chat', { formati: 1 }), null, 'senza sapere se il documento era intero non si conta');
});

const SPORCHI = ['rendilo più gentile, per favore', '<img src=x onerror=alert(1)>', 'Lettera a Mario 🙂', 'x'.repeat(5000), '', '   ', null, 42, {}];

test('un testo, dell’HTML o un numero al posto di un nome non diventano una chiave né una voce', async () => {
  const b = banco();
  const campi = ['funzione', 'stato', 'action', 'uso', 'scorciatoia', 'esito', 'via', 'cosa'];
  for (const misura of C.MISURE_RIQUADRI) {
    for (const x of SPORCHI) {
      for (const c of campi) {
        const d = v(misura, { funzione: 'spiega', stato: 'pronto', action: A.EXPLAIN, uso: 'copia', scorciatoia: 'formale', esito: 'copiato',
          proposte: 1, rimasto: 0, originale: true, via: 'automatico', oltreTetto: false, formati: 1, [c]: x });
        if (d) b.s.riquadro(d);
      }
      assert.equal(C.registraRiquadro(C.oraVuota(), misura, String(x), [String(x)]), false, `${misura}: «${x}» entrerebbe nell'ora`);
    }
    assert.equal(b.s.riquadro(null), false);
  }
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  const tutto = JSON.stringify([b.per, b.disco.get(Servizio.CHIAVE)]);
  for (const x of ['gentile', 'onerror', 'Mario', 'xxxxxxxxxx', '🙂']) assert.ok(!tutto.includes(x), `«${x}» è uscito`);
  assert.equal(b.per.riquadri.length, 1);
  assert.equal(C.validaRiquadri(b.per.riquadri[0].doc).ok, true);
});

test('i riquadri partono accanto alla loro ora, con lo stesso id; un’ora senza riquadri non ha il loro documento', async () => {
  const b = banco();
  b.s.riquadro(v('riquadro_uso', { action: A.TRANSLATE_SELECTION, uso: 'copia' }));
  b.s.riquadro(v('riquadro_uso', { action: A.TRANSLATE_SELECTION, domande: 1 }));
  b.s.riquadro(v('riscrittura', { scorciatoia: 'formale', esito: 'sostituito', proposte: 1 }));
  b.s.riquadro(v('traduzione_pagina', { esito: 'parziale', rimasto: 0.2, originale: true }));
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.per.ore.length, 1);
  assert.equal(b.per.riquadri.length, 1);
  const [{ url, doc }] = b.per.riquadri;
  assert.ok(url.includes(`documentId=${encodeURIComponent(C.idDocumento(b.per.ore[0].doc))}`), 'lo stesso id dell’ora');
  assert.deepEqual(Object.keys(doc), [...C.CAMPI_RIQUADRI]);
  assert.deepEqual(C.leggiRiquadri('riquadro_uso', doc.riquadro_uso['translate-selection']), [
    { copia: 1, d0: 0, d1: 1, d2: 0, d3_oltre: 0, approfondisci: 0, ricominciata: 0 },
  ]);
  assert.equal(C.leggiRiquadri('riscrittura', doc.riscrittura.formale)[0]['sostituito|p1'], 1);
  assert.equal(C.leggiRiquadri('traduzione_pagina', doc.traduzione_pagina.parziale)[0]['r25|si'], 1);
  assert.deepEqual(doc.ocr, {}, 'una misura senza conti esce vuota');

  b.s.erroreVisto('rete:-105');
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.per.ore.length, 2);
  assert.equal(b.per.riquadri.length, 1, 'l’ora senza riquadri non ha il loro documento');
});

test('in incognito e a contatori spenti i riquadri non si contano e non partono', async () => {
  const b = banco({ incognito: true });
  b.s.riquadro(v('ocr', { esito: 'copiato' }));
  await attendi();
  b.incognito = false;
  b.s.riquadro(v('ocr', { esito: 'annullato' }));
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.deepEqual(Object.keys(b.per.riquadri[0].doc.ocr), ['annullato'], 'conta solo quello fuori dall’incognito');

  b.accesi = false;
  b.s.riquadro(v('ocr', { esito: 'vuoto' }));
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'spenti');
  b.accesi = true;
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.per.riquadri.length, 1, 'spenti, niente si conta e niente parte');
});

// ── Gli agganci nel codice ─────────────────────────────────────────────────
const MANDANO = [['src', 'content', 'actions.js'], ['src', 'content', 'popup.js'], ['src', 'content', 'editBox.js'],
  ['src', 'content', 'translatePage.js'], ['src', 'content', 'content.js'], ['src', 'pages', 'editor', 'editor.js']];

test('le pagine mandano solo misure dell’elenco, e ogni misura ha chi la manda', () => {
  const viste = new Set();
  for (const p of MANDANO) {
    const s = leggi(...p);
    for (const m of s.matchAll(/cosa: '([a-z_]+)'|contaRiquadro\('([a-z_]+)'/g)) {
      const cosa = m[1] || m[2];
      assert.ok(C.MISURE_RIQUADRI.includes(cosa), `${p.join('/')}: «${cosa}» non è una misura dei riquadri`);
      viste.add(cosa);
    }
  }
  assert.deepEqual([...viste].sort(), [...C.MISURE_RIQUADRI].sort(), 'ogni misura ha chi la manda');
  assert.match(leggi('src', 'main', 'services', 'handlers', 'contatori.js'), /case 'riquadro': ok = contatori\.riquadro\(C\.voceRiquadro\(testo\(m\.cosa\), m\)\)/);
});

test('le funzioni dei riquadri sono funzioni contate, e le azioni che le pagine mandano ci arrivano', () => {
  for (const f of C.FUNZIONI_RIQUADRO) assert.ok(C.funzioni().includes(f), `«${f}» non è nel censimento delle funzioni`);
  const azioni = new Set();
  for (const p of MANDANO) {
    for (const m of leggi(...p).matchAll(/action: (?:ACTIONS\.([A-Z_]+)|popup\.action)/g)) if (m[1]) azioni.add(m[1]);
  }
  assert.ok(azioni.size >= 4);
  for (const a of azioni) {
    if (['EXPLAIN', 'EXPLAIN_DEEP', 'EXPLAIN_LINK', 'DESCRIBE_IMAGE', 'TRANSLATE_SELECTION'].includes(a)) {
      assert.ok(C.FUNZIONI_RIQUADRO.includes(C.funzioneDi(A[a])), `ACTIONS.${a} non arriva a una funzione dei riquadri`);
    }
  }
  // Il popup apre Approfondisci e Traduci (e Spiega da tastiera): tutte e tre stanno nell'elenco.
  for (const a of [A.EXPLAIN, A.EXPLAIN_DEEP, A.TRANSLATE_SELECTION]) assert.ok(C.FUNZIONI_RIQUADRO.includes(C.funzioneDi(a)), a);
});

test('le scorciatoie della riscrittura sono quelle del riquadro, e ognuna ha il suo nome contato', () => {
  const s = leggi('src', 'content', 'editBox.js');
  const tasti = [...s.matchAll(/data-sc="([a-z]+)"/g)].map((m) => m[1]);
  const contata = /const CONTATA = \{([^}]*)\}/.exec(s);
  assert.ok(contata, 'manca la tabella dei nomi contati');
  const mappa = Object.fromEntries([...contata[1].matchAll(/(\w+): '([a-z_]+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(mappa).sort(), [...tasti].sort(), 'ogni tasto ha il suo nome, e nessuno in più');
  assert.deepEqual([...Object.values(mappa), 'libera'].sort(), [...C.SCORCIATOIE].sort());
});
