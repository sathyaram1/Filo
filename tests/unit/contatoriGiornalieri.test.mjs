// I contatori giornalieri (#969), la parte pura: esce solo quello che sta negli elenchi chiusi, e lo pseudonimo è del
// mese, nuovo a ogni mese e mai uguale al codice dei feedback o allo pseudonimo dei crediti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'modelUsage.js'));
require(join(ROOT, 'src', 'shared', 'wallet.js'));
require(join(ROOT, 'src', 'shared', 'contatoriGiornalieri.js'));
const C = globalThis.SN_CONTATORI;
const U = globalThis.SN_MODEL_USAGE;
const A = globalThis.SN_CONST.ACTIONS;

const PSEUDO = '0123456789abcdef0123';
const docDi = (dati, extra = {}) => C.documento({ pseudonimo: PSEUDO, giorno: '2026-10-15', app: '0.2.243', os: 'win', dati, ...extra });

test('le funzioni contate sono quelle dell’app che usano un modello, né più né meno', () => {
  const attese = U.ENTRIES.filter((e) => (e.from === 'user' && e.ref) || (e.from === 'owner' && e.action)).map((e) => e.id);
  assert.deepEqual(C.funzioni(), attese);
  assert.ok(!C.funzioni().includes('judge1'), 'i giudici girano sul server: non li conta l’app');
  assert.ok(!C.funzioni().includes('cmd-classify'), 'un punto senza modello non si conta');
  assert.equal(C.funzioneDi(A.FILO_CHAT), 'filo-chat');
  assert.equal(C.funzioneDi(A.MANAGE_SEARCH), 'manage-search', 'le funzioni dell’owner si riconoscono dall’azione, non dallo slot');
  assert.equal(C.funzioneDi('un testo qualsiasi'), '');
});

test('un campo di testo libero non passa: funzione, modello, host e tipo vengono da elenchi chiusi', () => {
  const g = C.giornoVuoto();
  assert.equal(C.registraUso(g, 'Mario Rossi, via Roma 1', 300), false);
  assert.equal(C.registraErrore(g, 'explain', { modello: 'x', host: 'y', tipo: 'il mio errore preferito' }), false);
  assert.equal(C.registraErrore(g, 'filo-chat', { modello: 'Scrivi a mario.rossi@gmail.com', host: 'Mario <mario@x.it>', tipo: 'rete' }), true);
  assert.equal(C.registraUso(g, 'filo-chat', 1200), true);
  // Un disco manomesso: chiavi e valori che l'app non scriverebbe mai.
  g.uso['testo segreto'] = { n: 3, fasce: {} };
  g.uso['filo-chat'].fasce['la mia fascia'] = 4;
  g.uso['filo-chat'].nota = 'ciao';
  g.errori['explain'] = { 'deepseek/deepseek-v4-pro|DeepInfra|inventato': 2 };
  g.titolo = 'la pagina di prima';
  const doc = docDi(g);
  assert.deepEqual(doc.uso, { 'filo-chat': '1;0,0,1,0,0,0,0' });
  assert.deepEqual(C.leggiUso(doc.uso['filo-chat']), { n: 1, fasce: { s2: 1 } });
  assert.deepEqual(doc.errori, { 'filo-chat': 'altro||rete|1' });
  assert.deepEqual(C.leggiErrori(doc.errori['filo-chat']), [{ modello: 'altro', host: '', tipo: 'rete', n: 1 }]);
  assert.deepEqual(Object.keys(doc), [...C.CAMPI]);
  const tutto = JSON.stringify(doc);
  for (const parola of ['Mario', 'mario', 'Roma', 'segreto', 'ciao', 'pagina', 'inventato', 'preferito']) {
    assert.ok(!tutto.includes(parola), `«${parola}» è uscito nel documento: ${tutto}`);
  }
  assert.deepEqual(C.valida(doc), { ok: true, motivo: '' });
});

test('il validatore respinge quello che le regole non vedono: valori annidati fuori forma', () => {
  const buono = docDi({ uso: { help: { n: 2, fasce: { s1: 1, oltre: 1 } } }, errori: { help: { 'z-ai/glm-5.3|Baseten|tempo': 1 } } });
  assert.equal(C.valida(buono).ok, true);
  const rotti = [
    { ...buono, nota: 'x' },
    { ...buono, os: 'Windows 11' },
    { ...buono, app: 'ciao' },
    { ...buono, pseudonimo: 'mario' },
    { ...buono, mese: '2026-09' },
    { ...buono, uso: { help: '1;0,2,0,0,0,0,0' } },
    { ...buono, uso: { help: { n: 1, fasce: {} } } },
    { ...buono, uso: { help: '1;0,0,0,0,0,0,0;testo' } },
    { ...buono, uso: { 'non esiste': '1;0,0,0,0,0,0,0' } },
    { ...buono, errori: { help: 'Scrivi qui il tuo nome||rete|1' } },
    { ...buono, errori: { help: 'altro|a<b>|rete|1' } },
    { ...buono, errori: { help: [{ modello: 'altro', host: '', tipo: 'rete', n: 1 }] } },
    { ...buono, errori: { help: 'altro||rete|0' } },
    { ...buono, errori: { help: `altro||rete|1${';altro||rete|1'.repeat(C.TETTO_COMBINAZIONI)}` } },
  ];
  for (const r of rotti) assert.equal(C.valida(r).ok, false, `doveva essere respinto: ${JSON.stringify(r)}`);
});

test('le attese finiscono in fasce, e l’uso senza risposta conta senza fascia', () => {
  const g = C.giornoVuoto();
  for (const ms of [120, 900, 1500, 4000, 9000, 29000, 61000]) C.registraUso(g, 'explain', ms);
  C.registraUso(g, 'explain', null);
  const d = docDi(g);
  assert.equal(d.uso.explain, '8;1,1,1,1,1,1,1');
  assert.deepEqual(C.leggiUso(d.uso.explain), { n: 8, fasce: { ms500: 1, s1: 1, s2: 1, s5: 1, s10: 1, s30: 1, oltre: 1 } });
});

test('le combinazioni di errore hanno un tetto, oltre si sommano in «altro» e non si perdono', () => {
  const g = C.giornoVuoto();
  for (let i = 0; i < C.TETTO_COMBINAZIONI + 5; i++) C.registraErrore(g, 'help', { modello: `x/modello-${i}`, host: 'Host', tipo: 'fornitore' });
  const lista = C.leggiErrori(docDi(g).errori.help);
  assert.ok(lista.length <= C.TETTO_COMBINAZIONI);
  assert.equal(lista.reduce((a, e) => a + e.n, 0), C.TETTO_COMBINAZIONI + 5);
});

test('il tipo di guasto viene dall’elenco chiuso, e annullare non è un guasto', () => {
  const e = (props, msg = 'x') => Object.assign(new Error(msg), props);
  assert.equal(C.tipoErrore(e({ status: 402 })), 'crediti');
  assert.equal(C.tipoErrore(new Error('OpenRouter 402: Insufficient credits')), 'crediti');
  assert.equal(C.tipoErrore(e({ status: 401 })), 'chiave');
  assert.equal(C.tipoErrore(e({ status: 403 }, 'OpenRouter 403: invalid key')), 'chiave');
  assert.equal(C.tipoErrore(e({ status: 403 }, 'OpenRouter 403: flagged by moderation')), 'fornitore');
  assert.equal(C.tipoErrore(e({ code: 'NO_ALLOWED_HOST' })), 'nessun_host');
  assert.equal(C.tipoErrore(e({ status: 404, code: 'MODEL_UNAVAILABLE' })), 'nessun_host');
  assert.equal(C.tipoErrore(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })), 'rete');
  assert.equal(C.tipoErrore(e({ code: 'ECONNRESET' })), 'rete');
  assert.equal(C.tipoErrore(e({ name: 'TimeoutError' })), 'tempo');
  assert.equal(C.tipoErrore(e({ status: 504 })), 'tempo');
  assert.equal(C.tipoErrore(e({}, 'connect ETIMEDOUT 1.2.3.4:443')), 'tempo');
  assert.equal(C.tipoErrore(e({ status: 500 })), 'fornitore');
  assert.equal(C.tipoErrore(e({ status: 429 })), 'fornitore');
  assert.equal(C.tipoErrore(e({ name: 'AbortError' })), null);
  for (const code of ['NO_API_KEY', 'LIMIT_REACHED', 'NO_MODEL_FOR_ACTION']) assert.equal(C.tipoErrore(e({ code })), null, code);
  for (const t of ['crediti', 'chiave', 'nessun_host', 'rete', 'tempo', 'fornitore']) assert.ok(C.ERRORI.includes(t));
});

test('lo pseudonimo cambia al cambio di mese e resta lo stesso dentro il mese', () => {
  let n = 0;
  const casuale = () => `${'a'.repeat(18)}${String(++n).padStart(2, '0')}`;
  const ott = C.pseudonimoDelMese({}, '2026-10', { casuale });
  const ott2 = C.pseudonimoDelMese(ott.pseudonimi, '2026-10', { casuale });
  const nov = C.pseudonimoDelMese(ott2.pseudonimi, '2026-11', { casuale });
  assert.equal(ott.id, ott2.id);
  assert.equal(ott2.nuovo, false);
  assert.notEqual(nov.id, ott.id);
  assert.equal(nov.nuovo, true);
  assert.match(nov.id, C.PSEUDONIMO_RE);
  // L'ultimo giorno di ottobre spedito a novembre resta di ottobre: la copia conta una volta per mese.
  assert.equal(C.pseudonimoDelMese(nov.pseudonimi, '2026-10', { casuale }).id, ott.id);
});

test('lo pseudonimo non è mai il codice dei feedback né lo pseudonimo dei crediti, nemmeno per caso', () => {
  const crediti = 'abcdef0123456789';
  const feedback = '6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f';
  // Un generatore che prova prima a ripetere uno dei due: si scarta e se ne prende un altro.
  const prove = [`${crediti}0000`, '11111111111111111111'];
  const r = C.pseudonimoDelMese({}, '2026-10', { casuale: () => prove.shift(), esclusi: [`${crediti}0000`, feedback] });
  assert.equal(r.id, '11111111111111111111');
  for (const altro of [crediti, feedback]) assert.notEqual(r.id, altro);
  assert.ok(!C.PSEUDONIMO_RE.test(crediti), 'lo pseudonimo dei crediti ha un’altra forma: non si scambiano');
  assert.ok(!C.PSEUDONIMO_RE.test(feedback), 'il codice dei feedback ha un’altra forma: non si scambiano');
  assert.throws(() => C.pseudonimoDelMese({}, '2026-10', { casuale: () => 'non va' }));
});

test('i giorni da spedire sono quelli chiusi, dal più vecchio, con un tetto', () => {
  const giorni = {};
  for (let d = 1; d <= 20; d++) giorni[`2026-10-${String(d).padStart(2, '0')}`] = C.giornoVuoto();
  assert.deepEqual(C.daInviare(giorni, '2026-10-03'), ['2026-10-01', '2026-10-02']);
  assert.equal(C.daInviare(giorni, '2026-10-21', 5).length, 5);
  assert.equal(C.daInviare(giorni, '2026-10-21', 5)[0], '2026-10-01');
  const via = C.potaGiorni(giorni, 15);
  assert.deepEqual(via, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
  assert.equal(Object.keys(giorni).length, 15);
  assert.equal(C.giornoPrima('2026-11-01'), '2026-10-31');
  assert.equal(C.giornoPrima('2026-01-01'), '2025-12-31');
  assert.equal(C.famigliaOs('win32'), 'win');
  assert.equal(C.famigliaOs('darwin'), 'mac');
  assert.equal(C.famigliaOs('linux'), 'linux');
  assert.equal(C.famigliaOs('freebsd'), 'altro');
});
